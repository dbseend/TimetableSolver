import type { Catalog, Day, Section } from "../../lib/types";
import { DAY_KO, DAYS } from "../../lib/types";
import { fmtCredits, fmtMin } from "../../lib/time";

/** 절제된 색(배경/글자/테두리). 글자색은 배경 대비 WCAG AA 이상. */
const PALETTE: [string, string, string][] = [
  ["#dbeafe", "#1e3a8a", "#3b82f6"],
  ["#ccfbf1", "#134e4a", "#14b8a6"],
  ["#ede9fe", "#4c1d95", "#8b5cf6"],
  ["#ffedd5", "#7c2d12", "#f97316"],
  ["#e0f2fe", "#0c4a6e", "#0ea5e9"],
  ["#fce7f3", "#831843", "#ec4899"],
  ["#dcfce7", "#14532d", "#22c55e"],
  ["#fef3c7", "#78350f", "#f59e0b"],
  ["#e0e7ff", "#312e81", "#6366f1"],
  ["#f1f5f9", "#1e293b", "#64748b"],
];

/** 과목 ID → 안정적인 색. 후보가 바뀌어도 같은 과목은 같은 색. */
export function courseColor(courseId: string): [string, string, string] {
  let h = 0;
  for (let i = 0; i < courseId.length; i++) h = (h * 31 + courseId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** 여러 후보의 선택 분반을 모두 담는 시간 축(정시 단위). 비교 중에는 같은 축을 쓴다. */
export function axisFor(catalog: Catalog, sectionIdSets: string[][]): { lo: number; hi: number } {
  const ms = sectionIdSets.flat().flatMap((id) => catalog.sections.find((s) => s.id === id)?.meetings ?? []);
  if (!ms.length) return { lo: 540, hi: 1080 };
  return {
    lo: Math.min(540, Math.floor(Math.min(...ms.map((m) => m.start_minute)) / 60) * 60),
    hi: Math.max(1080, Math.ceil(Math.max(...ms.map((m) => m.end_minute)) / 60) * 60),
  };
}

export function instructorNames(catalog: Catalog, s: Section): string {
  return s.instructor_ids.map((id) => catalog.instructors.find((i) => i.id === id)?.name ?? id).join(", ");
}

interface Props {
  catalog: Catalog;
  sectionIds: string[];
  axis?: { lo: number; hi: number };
  selectedSection?: string | null;
  onSelectSection?: (id: string | null) => void;
  testId?: string;
}

/** 선택 분반의 모든 Meeting을 그린다. 색 외에 과목명·시간 텍스트를 함께 표시한다. */
export function TimetableGrid({ catalog, sectionIds, axis, selectedSection, onSelectSection, testId }: Props) {
  const secs = sectionIds.map((id) => catalog.sections.find((s) => s.id === id)).filter((s): s is Section => !!s);
  const meetings = secs.flatMap((s) => s.meetings.map((m) => ({ s, m })));
  const days: Day[] = DAYS.filter((d, i) => i < 5 || meetings.some((x) => x.m.day === d));
  const { lo, hi } = axis ?? axisFor(catalog, [sectionIds]);
  const px = 0.9;
  const height = (hi - lo) * px + 12;
  const hours = Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => lo + i * 60);
  const course = (cid: string) => catalog.courses.find((c) => c.id === cid);
  const asyncSecs = secs.filter((s) => s.delivery_mode === "online_async");

  return (
    <div data-testid={testId}>
      <div className="grid-wrap">
        <div className="tt" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(96px, 1fr))` }} role="grid" aria-label="시간표">
          <div className="tt-corner" />
          {days.map((d) => (
            <div key={d} className="tt-head" role="columnheader">
              {DAY_KO[d]}
            </div>
          ))}
          <div className="tt-hours" style={{ height }} aria-hidden>
            {hours.map((h) => (
              <span key={h} style={{ top: (h - lo) * px + 6 }}>
                {fmtMin(h)}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className="tt-col" style={{ height }} role="gridcell" aria-label={`${DAY_KO[d]}요일`}>
              {hours.map((h) => (
                <div key={h} className="tt-line" style={{ top: (h - lo) * px + 6 }} />
              ))}
              {meetings
                .filter((x) => x.m.day === d)
                .map(({ s, m }) => {
                  const c = course(s.course_id);
                  const [bg, fg, bd] = courseColor(s.course_id);
                  const h = (m.end_minute - m.start_minute) * px;
                  const label = `${c?.name ?? s.course_id} ${s.section_label}분반, ${DAY_KO[d]} ${fmtMin(m.start_minute)}-${fmtMin(m.end_minute)}${m.room ? `, ${m.room}` : ""}`;
                  return (
                    <button
                      type="button"
                      key={s.id + m.start_minute}
                      className="tt-block"
                      style={{ top: (m.start_minute - lo) * px + 6, height: h, background: bg, color: fg, borderLeftColor: bd }}
                      aria-label={label}
                      aria-pressed={selectedSection === s.id}
                      onClick={() => onSelectSection?.(selectedSection === s.id ? null : s.id)}
                    >
                      <span className="name">{c?.name ?? s.course_id}</span>
                      <span className="time">
                        {fmtMin(m.start_minute)}–{fmtMin(m.end_minute)}
                      </span>
                      {h >= 58 && (
                        <span className="extra">
                          {m.room ?? (s.delivery_mode === "online_sync" ? "온라인(실시간)" : "")}
                          {m.room && s.delivery_mode === "online_sync" ? " · 온라인" : ""}
                        </span>
                      )}
                      {h >= 74 && <span className="extra">{instructorNames(catalog, s)}</span>}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
      {asyncSecs.length > 0 && (
        <p className="small muted" style={{ marginTop: 8 }}>
          시간이 없는 비동기 온라인 수업: {asyncSecs.map((s) => `${course(s.course_id)?.name ?? s.course_id} ${s.section_label}분반`).join(", ")}
        </p>
      )}
    </div>
  );
}

/** 선택한 수업 블록의 상세(작은 블록도 클릭·키보드로 열람). */
export function SectionDetail({ catalog, sectionId, onClose }: { catalog: Catalog; sectionId: string; onClose: () => void }) {
  const s = catalog.sections.find((x) => x.id === sectionId);
  if (!s) return null;
  const c = catalog.courses.find((x) => x.id === s.course_id);
  return (
    <div className="detail" role="region" aria-label="수업 상세" data-testid="section-detail">
      <div className="row">
        <b>
          {c?.name} <span className="muted">({s.course_id})</span>
        </b>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          닫기
        </button>
      </div>
      <span className="small">
        {s.section_label}분반 · {c ? fmtCredits(c.credit_units) : "-"}학점 · {instructorNames(catalog, s) || "교수 정보 없음"}
      </span>
      <span className="small num">
        {s.meetings.length ? s.meetings.map((m) => `${DAY_KO[m.day]} ${fmtMin(m.start_minute)}–${fmtMin(m.end_minute)}${m.room ? ` (${m.room})` : ""}`).join(" · ") : "시간 없음(비동기)"}
      </span>
      {c && c.category_ids.length > 0 && <span className="xs muted">분류: {c.category_ids.join(", ")}</span>}
    </div>
  );
}
