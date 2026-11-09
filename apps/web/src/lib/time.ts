/** 정수 분 ↔ 문자열. 시간은 자정 기준 정수 분, 구간은 [start,end). */

export function fmtMin(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "09:10" -> 550. 24:00은 종료 시각에만 허용. 형식 오류는 null(추정하지 않음). */
export function parseHHMM(text: string, isEnd: boolean): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (mi >= 60) return null;
  const t = h * 60 + mi;
  if (t > 1440 || (t === 1440 && !isEnd)) return null;
  return t;
}

/** "1.5" -> 150, ".5" -> 50. 0.01 학점보다 세밀하면 null(자동 반올림 금지). 부동소수 곱셈을 쓰지 않는다. */
export function creditToUnits(text: string): number | null {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(text.trim());
  if (!m || (m[1] === "" && m[2] === undefined)) return null;
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > 2) return null;
  return Number(m[1] || "0") * 100 + Number(frac.padEnd(2, "0") || "0");
}

export function fmtCredits(units: number): string {
  return `${units / 100}`;
}
