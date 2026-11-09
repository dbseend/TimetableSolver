import { useEffect, useState } from "react";
import { getHealth } from "../api/client";

type State = "checking" | "waking" | "ok" | "error";

const WAKING_AFTER_MS = 3000;

export default function HealthStatus() {
  const [state, setState] = useState<State>("checking");

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => setState((s) => (s === "checking" ? "waking" : s)), WAKING_AFTER_MS);
    getHealth(ctrl.signal)
      .then(() => setState("ok"))
      .catch(() => {
        if (!ctrl.signal.aborted) setState("error");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, []);

  const label: Record<State, string> = {
    checking: "서버 확인 중…",
    waking: "서버를 깨우는 중… (최대 1분)",
    ok: "서버 연결됨",
    error: "서버에 연결할 수 없음",
  };
  return (
    <span role="status" style={{ marginLeft: "auto", fontSize: 13 }}>
      {label[state]}
    </span>
  );
}
