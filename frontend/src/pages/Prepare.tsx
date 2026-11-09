import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { getCatalog, getSemesters, type Catalog, type Semester } from "../api/client";
import { useSession } from "../state";

const SAMPLES = {
  "합성 50분반": () => import("../../../data/synthetic/catalog_50.json"),
  "합성 200분반": () => import("../../../data/synthetic/catalog_200.json"),
};

export default function Prepare() {
  const { catalog, setCatalog, pool, setPool } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [loadingCatalogId, setLoadingCatalogId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getSemesters()
      .then((items) => {
        if (active && Array.isArray(items)) setSemesters(items);
      })
      .catch(() => {
        // DB not configured or unreachable: local samples & file upload remain available
      });
    return () => {
      active = false;
    };
  }, []);

  function use(c: Catalog) {
    setCatalog(c);
    setPool([]);
    setError(null);
  }

  async function onSelectSemester(id: string) {
    try {
      setLoadingCatalogId(id);
      setError(null);
      const data = await getCatalog(id);
      use(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "카탈로그를 불러오지 못했습니다.");
    } finally {
      setLoadingCatalogId(null);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Catalog;
      if (!Array.isArray(data.courses) || !Array.isArray(data.sections)) throw new Error();
      use(data);
    } catch {
      setError("카탈로그 JSON이 아닙니다. courses, sections 배열이 필요합니다.");
    }
  }

  const inPool = new Set(pool.map((p) => p.course_id));
  const matches = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog.courses
      .filter((c) => !q || c.id.toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
      .slice(0, 50);
  }, [catalog, query]);
  const names = new Map(catalog?.courses.map((c) => [c.id, c]) ?? []);

  return (
    <section>
      <h2>1. 수강 정보 준비</h2>

      <h3>개설강좌</h3>
      {(semesters ?? []).length > 0 && (
        <p>
          <span style={{ marginRight: 8, fontWeight: 500 }}>학기 선택:</span>
          {semesters.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectSemester(s.id)}
              disabled={loadingCatalogId === s.id}
              style={{ marginRight: 6 }}
            >
              {loadingCatalogId === s.id ? "불러오는 중..." : `${s.label} (${s.id})`}
            </button>
          ))}
        </p>
      )}
      <p>
        {Object.entries(SAMPLES).map(([label, load]) => (
          <button key={label} onClick={async () => use((await load()).default as Catalog)}>
            {label} 불러오기
          </button>
        ))}{" "}
        <label>
          카탈로그 JSON 파일: <input type="file" accept=".json,application/json" onChange={onFile} />
        </label>
      </p>
      <p style={{ fontSize: 13, color: "#555" }}>
        실제 개설강좌는 <code>backend/scripts/import_hisnet.py</code>로 변환한 JSON을 올린다. 파일은 이
        브라우저에만 저장된다.
      </p>
      {error && <p role="alert">{error}</p>}
      {catalog && (
        <p>
          과목 {catalog.courses.length}개, 분반 {catalog.sections.length}개
        </p>
      )}

      {catalog && (
        <>
          <h3>관심 과목 ({pool.length})</h3>
          {pool.length === 0 && <p>아래에서 들을 만한 과목을 담는다. 솔버는 이 안에서만 고른다.</p>}
          <ul aria-label="관심 과목">
            {pool.map((p) => (
              <li key={p.course_id}>
                {names.get(p.course_id)?.name ?? p.course_id} ({p.course_id}){" "}
                <label>
                  우선순위{" "}
                  <select
                    value={p.priority ?? 3}
                    onChange={(e) =>
                      setPool(
                        pool.map((x) =>
                          x.course_id === p.course_id ? { ...x, priority: Number(e.target.value) } : x,
                        ),
                      )
                    }
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>{" "}
                <button onClick={() => setPool(pool.filter((x) => x.course_id !== p.course_id))}>빼기</button>
              </li>
            ))}
          </ul>

          <h3>과목 찾기</h3>
          <input
            aria-label="과목 검색"
            placeholder="과목명 또는 코드"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul>
            {matches.map((c) => (
              <li key={c.id}>
                {c.name} ({c.id}, {c.credit}학점, {c.category}){" "}
                <button
                  disabled={inPool.has(c.id)}
                  onClick={() => setPool([...pool, { course_id: c.id, priority: 3 }])}
                >
                  담기
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
