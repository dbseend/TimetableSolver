// 생성된 OpenAPI 타입(src/generated/api-types.ts)의 별칭. 손으로 계약을 복제하지 않는다.
import type { components } from "../generated/api-types";

type S = components["schemas"];
type Full<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: Exclude<T[P], undefined> };
/** 서버가 정규화해 돌려준(기본값이 모두 채워진) 카탈로그 타입. 입력 스키마의 선택 필드를 필수로 좁힌다. */
export type Meeting = Full<S["Meeting"], "room">;
export type Instructor = S["Instructor"];
export type Course = Full<S["Course"], "category_ids" | "equivalence_group_id">;
export type Section = Omit<Full<S["Section"], "instructor_ids" | "support_status" | "issue_codes">, "meetings"> & { meetings: Meeting[] };
export type Catalog = Omit<
  Full<S["Catalog"], "schema_version" | "timezone" | "data_origin" | "category_groups" | "instructors">,
  "courses" | "sections"
> & { courses: Course[]; sections: Section[] };
export type SolveRequest = S["SolveRequest"];
export type SolveResponse = S["SolveResponse"];
export type Candidate = S["Candidate"];
export type ConstraintEvaluation = S["ConstraintEvaluation"];
export type DiagnoseRequest = S["DiagnoseRequest"];
export type DiagnosisResponse = S["DiagnosisResponse"];
export type RelaxationProposal = S["RelaxationProposal"];
export type CatalogValidateResponse = S["CatalogValidateResponse"];
export type ParseRequest = S["ParseRequest"];
export type ParseResponse = S["ParseResponse"];
export type DraftConstraint = S["DraftConstraint"];
export type Question = S["Question"];
export type Capabilities = S["Capabilities"];
export type ErrorResponse = S["ErrorResponse"];

export type Constraint =
  | S["CreditRange"]
  | S["MustInclude"]
  | S["MustExclude"]
  | S["DayOff"]
  | S["TimeAvoid"]
  | S["CategoryMin"]
  | S["InstructorAvoid"]
  | S["MaxDaysOnCampus"];
export type ConstraintType = Constraint["type"];
export type Day = Meeting["day"];

export const DAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_KO: Record<Day, string> = { Mon: "월", Tue: "화", Wed: "수", Thu: "목", Fri: "금", Sat: "토", Sun: "일" };
