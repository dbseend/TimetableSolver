import type { Catalog, Constraint } from "./api/client";

const DAY: Record<string, string> = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토" };
const days = (ds: string[]) =>
  ds.length === 5 && !ds.includes("Sat") ? "평일" : ds.map((d) => DAY[d] ?? d).join("·");

/** One-line Korean reading of a constraint for chips and result panels. */
export function summarize(c: Constraint, catalog?: Catalog | null): string {
  const course = (id: string) => catalog?.courses.find((x) => x.id === id)?.name ?? id;
  switch (c.type) {
    case "credit_range":
      return `총 ${c.params.min}–${c.params.max}학점`;
    case "must_include":
      return `${course(c.params.course_id)} 포함`;
    case "must_exclude":
      return `${course(c.params.course_id)} 제외`;
    case "day_off":
      return `${days(c.params.days)} 공강`;
    case "time_avoid":
      return `${days(c.params.days)} ${c.params.start}–${c.params.end} 피하기`;
    case "time_prefer":
      return `${days(c.params.days)} ${c.params.start}–${c.params.end} 선호`;
    case "max_gap":
      return `공강 최대 ${c.params.minutes}분`;
    case "lunch_free":
      return `점심(${c.params.start}–${c.params.end}) ${c.params.min_free_minutes}분 비우기`;
    case "max_consecutive":
      return `연강 최대 ${c.params.minutes}분`;
    case "max_days_on_campus":
      return `주 ${c.params.max_days}일 이하 등교`;
    case "category_min":
      return `${c.params.category} ${c.params.credits}학점 이상`;
    case "instructor_avoid":
      return `${c.params.instructor} 피하기`;
    case "instructor_prefer":
      return `${c.params.instructor} 선호`;
  }
}

/** Give appended constraints ids that do not clash with the existing ones. */
export function append(existing: Constraint[], added: Constraint[]): Constraint[] {
  const used = new Set(existing.map((c) => c.id));
  let n = existing.length;
  const fresh = added.map((c) => {
    let id: string;
    do id = `c${++n}`;
    while (used.has(id));
    used.add(id);
    return { ...c, id };
  });
  return [...existing, ...fresh];
}
