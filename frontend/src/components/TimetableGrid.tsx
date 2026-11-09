import type { Catalog } from "../api/client";

const DAY_LABEL: Record<string, string> = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토" };
const PX_PER_MIN = 0.6;

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export type Block = { day: string; start: string; end: string; label: string; sectionId: string };

export function blocksFor(catalog: Catalog, sectionIds: string[]): Block[] {
  const names = new Map(catalog.courses.map((c) => [c.id, c.name]));
  const byId = new Map(catalog.sections.map((s) => [s.id, s]));
  return sectionIds.flatMap((id) => {
    const s = byId.get(id);
    if (!s) return [];
    return (s.meetings ?? []).map((m) => ({ ...m, sectionId: id, label: names.get(s.course_id) ?? s.course_id }));
  });
}

export default function TimetableGrid({ blocks }: { blocks: Block[] }) {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", ...(blocks.some((b) => b.day === "Sat") ? ["Sat"] : [])];
  const top = Math.min(9 * 60, ...blocks.map((b) => Math.floor(toMin(b.start) / 60) * 60));
  const bottom = Math.max(18 * 60, ...blocks.map((b) => Math.ceil(toMin(b.end) / 60) * 60));
  const hours = Array.from({ length: (bottom - top) / 60 }, (_, i) => top / 60 + i);
  const height = (bottom - top) * PX_PER_MIN;

  return (
    <div
      role="table"
      aria-label="시간표"
      style={{ display: "grid", gridTemplateColumns: `40px repeat(${days.length}, 1fr)`, fontSize: 12 }}
    >
      <div />
      {days.map((d) => (
        <div key={d} role="columnheader" style={{ textAlign: "center", fontWeight: 600 }}>
          {DAY_LABEL[d]}
        </div>
      ))}
      <div style={{ position: "relative", height }}>
        {hours.map((h) => (
          <div key={h} style={{ position: "absolute", top: (h * 60 - top) * PX_PER_MIN, color: "#888" }}>
            {h}
          </div>
        ))}
      </div>
      {days.map((d) => (
        <div key={d} style={{ position: "relative", height, borderLeft: "1px solid #ddd" }}>
          {hours.map((h) => (
            <div
              key={h}
              style={{ position: "absolute", top: (h * 60 - top) * PX_PER_MIN, left: 0, right: 0, borderTop: "1px solid #f0f0f0" }}
            />
          ))}
          {blocks
            .filter((b) => b.day === d)
            .map((b) => (
              <div
                key={`${b.sectionId}-${b.start}`}
                role="cell"
                aria-label={`${DAY_LABEL[d]} ${b.start}–${b.end} ${b.label}`}
                style={{
                  position: "absolute",
                  top: (toMin(b.start) - top) * PX_PER_MIN,
                  height: (toMin(b.end) - toMin(b.start)) * PX_PER_MIN,
                  left: 2,
                  right: 2,
                  background: "#e8f0fe",
                  border: "1px solid #8ab4f8",
                  borderRadius: 4,
                  padding: 2,
                  overflow: "hidden",
                }}
              >
                {b.label}
                <br />
                {b.start}–{b.end}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
