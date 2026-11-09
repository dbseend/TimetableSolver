import { useState } from "react";
import { ApiError, postParse, type Catalog, type Constraint, type ParseResponse } from "../api/client";
import { append, summarize } from "../constraints";
import { useSession } from "../state";

export function parseConstraints(text: string): { value: unknown[] } | { error: string } {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? { value } : { error: "제약은 JSON 배열이어야 한다." };
  } catch (e) {
    return { error: `JSON 오류: ${(e as Error).message}` };
  }
}

function summaryOf(catalog: Catalog | null) {
  if (!catalog) return null;
  return {
    courses: catalog.courses.map((c) => ({ id: c.id, name: c.name })),
    instructors: [...new Set(catalog.sections.map((s) => s.instructor).filter((i): i is string => !!i))],
    categories: [...new Set(catalog.courses.map((c) => c.category))],
  };
}

type Notes = Pick<ParseResponse, "ambiguities" | "entity_candidates">;

export default function Preferences() {
  const { catalog, constraintsText, setConstraintsText } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Notes>({ ambiguities: [], entity_candidates: [] });
  const parsed = parseConstraints(constraintsText);
  const constraints = ("value" in parsed ? parsed.value : []) as Constraint[];
  const save = (list: Constraint[]) => setConstraintsText(JSON.stringify(list, null, 2));

  async function interpret() {
    setBusy(true);
    setError(null);
    try {
      const r = await postParse({ text, catalog_summary: summaryOf(catalog) });
      const before = constraints.length;
      const merged = append(constraints, r.constraints);
      // ambiguity ids refer to the parser's numbering; map them onto the appended ids
      const idMap = new Map(r.constraints.map((c, i) => [c.id, merged[before + i].id]));
      save(merged);
      setNotes({
        ambiguities: (r.ambiguities ?? []).map((a) => ({
          ...a,
          constraint_id: a.constraint_id ? (idMap.get(a.constraint_id) ?? null) : null,
        })),
        entity_candidates: r.entity_candidates ?? [],
      });
      setText("");
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === "llm_disabled"
          ? "서버에 자연어 해석이 설정되어 있지 않다. 아래 'JSON 직접 편집'을 쓴다."
          : `해석 실패: ${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function update(id: string, patch: Partial<Constraint>) {
    save(constraints.map((c) => (c.id === id ? ({ ...c, ...patch } as Constraint) : c)));
  }

  function pick(mention: string, kind: string, value: string) {
    save(
      constraints.map((c) => {
        if (kind === "course" && "course_id" in c.params && c.params.course_id === mention)
          return { ...c, params: { course_id: value } } as Constraint;
        if (kind === "instructor" && "instructor" in c.params && c.params.instructor === mention)
          return { ...c, params: { instructor: value } } as Constraint;
        return c;
      }),
    );
    setNotes({ ...notes, entity_candidates: notes.entity_candidates?.filter((e) => e.mention !== mention) });
  }

  const warn = new Map((notes.ambiguities ?? []).filter((a) => a.constraint_id).map((a) => [a.constraint_id!, a]));

  return (
    <section>
      <h2>2. 선호 입력</h2>
      <label>
        원하는 시간표를 말로 적는다
        <textarea
          aria-label="선호 문장"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="예: 금요일엔 수업 없었으면 좋겠고, 아침 9시 수업은 절대 싫어. 점심은 꼭 비워줘."
          style={{ display: "block", width: "100%", marginTop: 4 }}
        />
      </label>
      <p style={{ fontSize: 12, color: "#555" }}>
        입력한 문장은 해석을 위해 Google Gemini로 전송된다. 이름·학번 같은 개인정보는 쓰지 않는다.
      </p>
      <button onClick={interpret} disabled={busy || !text.trim()}>
        {busy ? "해석 중…" : "해석하기"}
      </button>
      {error && <p role="alert">{error}</p>}

      {(notes.entity_candidates ?? []).map((e) => (
        <p key={e.mention} role="group" aria-label={`'${e.mention}' 확인`}>
          ‘{e.mention}’는 어느 {e.kind === "course" ? "과목" : "교수"}인가?{" "}
          {e.candidates.length === 0
            ? "맞는 항목을 찾지 못했다. 칩을 지우거나 고친다."
            : e.candidates.map((m) => (
                <button key={m.id} onClick={() => pick(e.mention, e.kind, m.id)}>
                  {m.name}
                </button>
              ))}
        </p>
      ))}

      <h3>해석된 조건 ({constraints.length})</h3>
      {constraints.length === 0 && <p>아직 없다. 문장을 해석하면 여기에 칩으로 나온다.</p>}
      <ul aria-label="조건 칩" style={{ listStyle: "none", padding: 0 }}>
        {constraints.map((c) => (
          <li
            key={c.id}
            style={{ border: "1px solid #ccc", borderRadius: 8, padding: 8, marginBottom: 6 }}
          >
            <strong>{summarize(c, catalog)}</strong>
            {c.source_text && <span style={{ color: "#666" }}> · “{c.source_text}”</span>}
            {warn.has(c.id) && (
              <div style={{ fontSize: 12, color: "#b06000" }}>
                ⚠ {warn.get(c.id)!.message}
                {warn.get(c.id)!.default_interpretation && ` (기본 해석: ${warn.get(c.id)!.default_interpretation})`}
              </div>
            )}
            <div style={{ fontSize: 13, marginTop: 4 }}>
              <button
                aria-label={`${summarize(c, catalog)} 강도`}
                onClick={() => update(c.id, { strength: c.strength === "hard" ? "soft" : "hard" })}
              >
                {c.strength === "hard" ? "반드시" : "가능하면"}
              </button>{" "}
              {c.strength === "soft" && (
                <label>
                  중요도{" "}
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={c.weight ?? 5}
                    onChange={(e) => update(c.id, { weight: Number(e.target.value) })}
                  />{" "}
                  {c.weight ?? 5}
                </label>
              )}{" "}
              <button aria-label={`${summarize(c, catalog)} 삭제`} onClick={() => save(constraints.filter((x) => x.id !== c.id))}>
                삭제
              </button>
            </div>
          </li>
        ))}
      </ul>
      {(notes.ambiguities ?? [])
        .filter((a) => !a.constraint_id)
        .map((a, i) => (
          <p key={i} style={{ fontSize: 13, color: "#b06000" }}>
            ⚠ {a.message}
          </p>
        ))}

      <details style={{ marginTop: 16 }}>
        <summary>JSON 직접 편집</summary>
        <textarea
          aria-label="제약 JSON"
          value={constraintsText}
          onChange={(e) => setConstraintsText(e.target.value)}
          rows={12}
          style={{ display: "block", width: "100%", fontFamily: "monospace", marginTop: 8 }}
        />
        {"error" in parsed ? <p role="alert">{parsed.error}</p> : <p>제약 {parsed.value.length}개</p>}
      </details>
    </section>
  );
}
