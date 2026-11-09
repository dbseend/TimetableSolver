"""격리 실행: 요청당 하나의 spawn 자식 프로세스. deadline/취소 시 terminate→kill→join으로 회수.

이벤트 루프를 막지 않도록 비동기 polling으로 기다린다. 동시 실행 수는 semaphore로 제한하며
슬롯이 없으면 즉시 SolverBusy(429)로 실패한다(무제한 큐 없음).
"""

from __future__ import annotations

import asyncio
import multiprocessing as mp
import os
import time
from collections.abc import Awaitable, Callable

_CTX = mp.get_context("spawn")


class SolverBusy(Exception):
    pass


class SolverTimeout(Exception):
    pass


class SolverCancelled(Exception):
    pass


class SolverCrashed(Exception):
    pass


def _child(kind: str, payload: dict, conn) -> None:  # pragma: no cover - 자식 프로세스
    try:
        from app.solver import engine

        fn = {"search": engine.run_search, "diagnose": engine.run_diagnosis, "sleep": _sleep_task}[kind]
        conn.send(("ok", fn(payload)))
    except BaseException as e:  # noqa: BLE001 - 입력 원문을 담지 않고 타입명만 전달
        conn.send(("err", type(e).__name__))
    finally:
        conn.close()


def _sleep_task(payload: dict) -> dict:  # 테스트용: 오래 걸리는 작업
    time.sleep(float(payload.get("seconds", 30)))
    return {"slept": True}


class ProcessRunner:
    def __init__(self, concurrency: int = 1):
        self.concurrency = concurrency
        self._sem = asyncio.Semaphore(concurrency)
        self.active_pids: set[int] = set()

    def busy(self) -> bool:
        return self._sem.locked()

    async def run(self, kind: str, payload: dict, hard_deadline_s: float, is_cancelled: Callable[[], Awaitable[bool]] | None = None) -> tuple[dict, float]:
        if self._sem.locked():
            raise SolverBusy()
        async with self._sem:
            return await self._run(kind, payload, hard_deadline_s, is_cancelled)

    async def _run(self, kind, payload, hard_deadline_s, is_cancelled):
        t0 = time.perf_counter()
        parent, child = _CTX.Pipe(duplex=False)
        proc = _CTX.Process(target=_child, args=(kind, payload, child), daemon=True)
        proc.start()
        child.close()
        self.active_pids.add(proc.pid)
        try:
            while True:
                if parent.poll():
                    tag, data = parent.recv()
                    if tag == "err":
                        raise SolverCrashed(data)
                    return data, (time.perf_counter() - t0) * 1000
                if not proc.is_alive() and not parent.poll():
                    raise SolverCrashed(f"exitcode={proc.exitcode}")
                if time.perf_counter() - t0 > hard_deadline_s:
                    raise SolverTimeout()
                if is_cancelled is not None and await is_cancelled():
                    raise SolverCancelled()
                await asyncio.sleep(0.02)
        finally:
            _reap(proc)
            parent.close()
            self.active_pids.discard(proc.pid)


def _reap(proc) -> None:
    if proc.is_alive():
        proc.terminate()
        proc.join(1.0)
    if proc.is_alive():
        proc.kill()
    proc.join(2.0)


class InProcessRunner(ProcessRunner):
    """테스트 전용(TIMETABLE_SOLVER_INPROCESS=1). 운영 경로가 아니다."""

    async def _run(self, kind, payload, hard_deadline_s, is_cancelled):
        from app.solver import engine

        t0 = time.perf_counter()
        fn = {"search": engine.run_search, "diagnose": engine.run_diagnosis}[kind]
        data = await asyncio.to_thread(fn, payload)
        return data, (time.perf_counter() - t0) * 1000


def make_runner() -> ProcessRunner:
    conc = int(os.environ.get("SOLVER_CONCURRENCY", "1"))
    if os.environ.get("TIMETABLE_SOLVER_INPROCESS") == "1":
        return InProcessRunner(conc)
    return ProcessRunner(conc)
