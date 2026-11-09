import { useSession } from "../state";

// Until natural-language parsing (D-e) lands, constraints are edited as the API's JSON.
const EXAMPLE = [
  { id: "c1", type: "credit_range", strength: "hard", params: { min: 12, max: 18 } },
  { id: "c2", type: "day_off", strength: "hard", params: { days: ["Fri"] } },
  { id: "c3", type: "lunch_free", strength: "soft", params: { start: "12:00", end: "13:00", min_free_minutes: 60 } },
];

export function parseConstraints(text: string): { value: unknown[] } | { error: string } {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? { value } : { error: "제약은 JSON 배열이어야 한다." };
  } catch (e) {
    return { error: `JSON 오류: ${(e as Error).message}` };
  }
}

export default function Preferences() {
  const { constraintsText, setConstraintsText } = useSession();
  const parsed = parseConstraints(constraintsText);

  return (
    <section>
      <h2>2. 선호 입력</h2>
      <p style={{ fontSize: 13, color: "#555" }}>
        자연어 입력은 다음 단계에서 붙는다. 지금은 제약 JSON을 직접 쓴다 (형식: docs/API.md).
      </p>
      <button onClick={() => setConstraintsText(JSON.stringify(EXAMPLE, null, 2))}>예시 넣기</button>
      <textarea
        aria-label="제약 JSON"
        value={constraintsText}
        onChange={(e) => setConstraintsText(e.target.value)}
        rows={16}
        style={{ display: "block", width: "100%", fontFamily: "monospace", marginTop: 8 }}
      />
      {"error" in parsed ? <p role="alert">{parsed.error}</p> : <p>제약 {parsed.value.length}개</p>}
    </section>
  );
}
