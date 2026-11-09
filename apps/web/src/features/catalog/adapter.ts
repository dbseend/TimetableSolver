/**
 * 학교별 개설강좌 표 → 내부 Catalog 변환(import adapter).
 *
 * - 샘플 CSV와 학교 CSV는 모두 이 함수를 거쳐 같은 Catalog 형식이 된다. 솔버는 Catalog만 안다.
 * - 학교별 차이(열 이름, 요일 표기, 교시→시각, 수업방식 표기, 분류명)는 AdapterConfig로 분리한다.
 * - 알 수 없는 값은 추측하지 않는다: 시간 미정·격주·파싱 실패 분반은 support_status="unsupported" + 문제 코드.
 * - 과목 학점·분류가 분반마다 다르면 자동 병합하지 않고 오류로 보여 준다(해당 과목 제외).
 */
import type { Catalog, Course, Day, Instructor, Meeting, Section } from "../../lib/types";
import { creditToUnits, parseHHMM } from "../../lib/time";

export type FieldKey =
  | "course_code"
  | "course_name"
  | "section"
  | "credit"
  | "category"
  | "instructor_id"
  | "instructor"
  | "delivery_mode"
  | "day"
  | "start"
  | "end"
  | "period"
  | "schedule"
  | "room"
  | "schedule_note"
  | "org";

export type TimeMode = "day_start_end" | "day_period" | "schedule_text";
export type DeliveryMode = Section["delivery_mode"];

export interface AdapterConfig {
  catalogId: string;
  termId: string;
  dataOrigin: Catalog["data_origin"];
  /** 내부 필드 → 원본 열 이름(헤더). 없는 필드는 미매핑. */
  columns: Partial<Record<FieldKey, string>>;
  timeMode: TimeMode;
  /** 교시 → [시작분, 종료분). day_period / schedule_text(교시 표기)에서 사용. */
  periodTable: PeriodTable;
  /** 요일별 교시표. 하나라도 있으면 공통 교시표 대신 이것을 쓰고, 표가 없는 요일의 교시는 미지원 처리한다. */
  periodTableByDay?: Partial<Record<Day, PeriodTable>>;
  /** 원본 분류명 → category id. 매핑에 없으면 분류명을 그대로 id로 쓴다. */
  categoryMap: Record<string, string>;
  categoryGroups: Record<string, string[]>;
  /** 수업방식 열이 없을 때 기본값. null이면 열이 없을 때 오류. */
  defaultDelivery: DeliveryMode | null;
  /** 셀에 줄바꿈이 있을 때 쓸 줄(0부터). 없으면 줄을 공백으로 이어 붙인다. 예: 과목명 1번째 줄(한글), 개설정보 2번째 줄(교수). */
  lines?: Partial<Record<FieldKey, number>>;
}

export interface ImportIssue {
  severity: "error" | "warning";
  row: number | null; // 1-based 데이터 행 번호(헤더 제외), 없으면 null
  code: string;
  message: string;
}

export interface ImportResult {
  catalog: Catalog | null;
  /** 과목 → 개설 소속(원문). 서버로 보내지 않는 로컬 메타데이터. 개설 소속은 학생의 전공 인정 기준과 같지 않을 수 있다. */
  courseOrgs: Record<string, string>;
  issues: ImportIssue[];
  stats: { rows: number; courses: number; sections: number; unsupportedSections: number; excludedCourses: number };
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  course_code: "과목코드*",
  course_name: "과목명*",
  section: "분반*",
  credit: "학점*",
  category: "이수구분",
  instructor_id: "교수 ID",
  instructor: "교수명",
  delivery_mode: "수업방식",
  day: "요일",
  start: "시작 시각(HH:MM)",
  end: "종료 시각(HH:MM)",
  period: "교시",
  schedule: "강의시간(예: 월1-2,수3)",
  room: "강의실",
  schedule_note: "비고(격주 등)",
  org: "개설 소속(학부·학과)",
};

const ALIASES: Record<FieldKey, string[]> = {
  course_code: ["course_code", "과목코드", "학수번호", "교과목번호", "과목번호", "code"],
  course_name: ["course_name", "과목명", "교과목명", "강좌명", "name", "과목명(CourseName)"],
  section: ["section", "분반", "분반번호", "class"],
  credit: ["credit", "학점", "credits"],
  category: ["category", "이수구분", "구분", "영역", "이수영역"],
  instructor_id: ["instructor_id", "교수id", "교수번호", "교번"],
  instructor: ["instructor", "교수명", "담당교수", "교수", "교강사"],
  delivery_mode: ["delivery_mode", "수업방식", "강의방식", "수업형태"],
  day: ["day", "요일"],
  start: ["start", "시작", "시작시간", "시작시각"],
  end: ["end", "종료", "종료시간", "종료시각"],
  period: ["period", "교시"],
  schedule: ["schedule", "강의시간", "수업시간", "시간표", "강의시간/강의실", "시간(Period)", "시간"],
  room: ["room", "강의실", "호실"],
  schedule_note: ["schedule_note", "비고", "note", "메모"],
  org: ["org", "department", "개설학과", "개설학부", "개설소속", "주관학과", "개설전공"],
};

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function guessColumns(headers: string[]): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  const used = new Set<string>();
  for (const key of Object.keys(ALIASES) as FieldKey[]) {
    const hit = headers.find((h) => !used.has(h) && ALIASES[key].some((a) => norm(a) === norm(h)));
    if (hit) {
      out[key] = hit;
      used.add(hit);
    }
  }
  return out;
}

export function guessTimeMode(cols: Partial<Record<FieldKey, string>>): TimeMode {
  if (cols.start && cols.end) return "day_start_end";
  if (cols.period) return "day_period";
  return "schedule_text";
}

export const DAY_ALIASES: Record<string, Day> = {
  월: "Mon", 화: "Tue", 수: "Wed", 목: "Thu", 금: "Fri", 토: "Sat", 일: "Sun",
  월요일: "Mon", 화요일: "Tue", 수요일: "Wed", 목요일: "Thu", 금요일: "Fri", 토요일: "Sat", 일요일: "Sun",
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

const DELIVERY_ALIASES: Record<string, DeliveryMode> = {
  in_person: "in_person", 대면: "in_person", 오프라인: "in_person",
  online_sync: "online_sync", 실시간: "online_sync", "온라인(실시간)": "online_sync", 실시간온라인: "online_sync", 동기: "online_sync",
  online_async: "online_async", 비실시간: "online_async", "온라인(비실시간)": "online_async", 비실시간온라인: "online_async", 비동기: "online_async", 녹화: "online_async",
};

/** 학교 표기에서 흔히 쓰는 분류명 기본 매핑(사용자가 화면에서 수정 가능). */
export const DEFAULT_CATEGORY_MAP: Record<string, string> = {
  전공필수: "major_required", 전필: "major_required",
  전공선택: "major_elective", 전선: "major_elective",
  교양: "general", 교양필수: "general_required", 교양선택: "general",
};

export type PeriodTable = Record<string, [number, number]>;

/**
 * 교시표 텍스트 → 공통/요일별 교시표.
 * - `1=09:00-10:15` 항목(한 줄에 여러 개도 가능). 머리글 없이 쓴 항목은 공통 교시표.
 * - `[월,화,목,금]`, `[수요일]` 같은 머리글 아래 항목은 그 요일 전용.
 * - 요일별 교시표가 하나라도 있으면 표가 없는 요일(예: 토·일)의 교시는 추정하지 않고 미지원 처리한다.
 */
export function parsePeriodTables(text: string): { common: PeriodTable; byDay: Partial<Record<Day, PeriodTable>>; errors: string[] } {
  const common: PeriodTable = {};
  const byDay: Partial<Record<Day, PeriodTable>> = {};
  const errors: string[] = [];
  let target: Day[] | null = null;
  const entry = /([0-9A-Za-z]+)\s*[=:]\s*(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})/g;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const h = /^\[(.+)\]$/.exec(line);
    if (h) {
      const days = [...h[1].replace(/요일/g, "").matchAll(/[월화수목금토일]/g)].map((m) => DAY_ALIASES[m[0]]);
      if (!days.length) errors.push(line);
      target = days.length ? days : null;
      for (const d of days) byDay[d] ??= {};
      continue;
    }
    const found = [...line.matchAll(entry)];
    const rest = line.replace(entry, "").replace(/[,\s]/g, "");
    if (!found.length || rest) {
      errors.push(line);
      continue;
    }
    for (const m of found) {
      const st = parseHHMM(m[2], false);
      const en = parseHHMM(m[3], true);
      if (st === null || en === null || st >= en) {
        errors.push(m[0]);
        continue;
      }
      if (target) for (const d of target) byDay[d]![m[1]] = [st, en];
      else common[m[1]] = [st, en];
    }
  }
  return { common, byDay, errors };
}

export function formatPeriodTable(table: PeriodTable): string {
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return Object.entries(table)
    .map(([k, [s, e]]) => `${k}=${f(s)}-${f(e)}`)
    .join("\n");
}

type RawMeeting = Omit<Meeting, "campus_required" | "room">;
type TimeParse = { meetings: RawMeeting[] } | { error: string };
type TableFor = (day: Day) => PeriodTable | undefined;

/**
 * "1-2", "1,2,3", "1~3" → 교시마다 그 교시의 수업 구간 그대로 Meeting 하나.
 * 연속 교시라도 교시 사이 쉬는 시간을 수업시간에 포함하지 않는다(합치지 않음).
 */
function periodsToMeetings(day: Day, text: string, tableFor: TableFor): TimeParse {
  const table = tableFor(day);
  if (!table) return { error: "PERIOD_TABLE_MISSING_FOR_DAY" };
  const keys: string[] = [];
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const r = /^(\d+)\s*[-~]\s*(\d+)$/.exec(part);
    if (r) {
      const a = Number(r[1]);
      const b = Number(r[2]);
      if (a > b) return { error: "PERIOD_RANGE" };
      for (let k = a; k <= b; k++) keys.push(String(k));
    } else keys.push(part);
  }
  if (!keys.length) return { error: "PERIOD_EMPTY" };
  const out: RawMeeting[] = [];
  for (const k of keys) {
    const span = table[k];
    if (!span) return { error: "PERIOD_UNKNOWN" };
    out.push({ day, start_minute: span[0], end_minute: span[1] });
  }
  return { meetings: out };
}

function parseDay(text: string): Day | null {
  return DAY_ALIASES[norm(text)] ?? null;
}

/** "월1-2,수3" 또는 "월 09:00-10:15 수 09:00-10:15" */
function parseScheduleText(text: string, tableFor: TableFor): TimeParse {
  const re = /([월화수목금토일])\s*([0-9:,\-~\s]+)/g;
  const meetings: RawMeeting[] = [];
  let consumed = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    consumed += m[0];
    const day = DAY_ALIASES[m[1]];
    const body = m[2].trim().replace(/,$/, "");
    if (body.includes(":")) {
      const t = /^(\d{1,2}:\d{2})\s*[-~]\s*(\d{1,2}:\d{2})$/.exec(body);
      const s = t ? parseHHMM(t[1], false) : null;
      const e = t ? parseHHMM(t[2], true) : null;
      if (s === null || e === null || s >= e) return { error: "TIME_FORMAT" };
      meetings.push({ day, start_minute: s, end_minute: e });
    } else {
      const r = periodsToMeetings(day, body, tableFor);
      if ("error" in r) return r;
      meetings.push(...r.meetings);
    }
  }
  // 해석하지 않은 문자(예: '(격주)', 강의실 표기)가 남으면 조용히 버리지 않는다.
  if (norm(text.replace(/[()/]/g, "")).length !== norm(consumed).length) return { error: "SCHEDULE_TEXT_UNPARSED" };
  return { meetings };
}

interface SectionAcc {
  courseId: string;
  label: string;
  firstRow: number;
  delivery: DeliveryMode | null;
  instructorIds: string[];
  meetings: Meeting[];
  issueCodes: Set<string>;
  timedRows: number;
  untimedRows: number;
}

interface CourseAcc {
  org: string;
  id: string;
  name: string;
  units: number | null;
  categoryLabel: string;
  firstRow: number;
  bad: boolean;
}

export function importCatalog(rows: string[][], cfg: AdapterConfig): ImportResult {
  const issues: ImportIssue[] = [];
  const stats = { rows: Math.max(0, rows.length - 1), courses: 0, sections: 0, unsupportedSections: 0, excludedCourses: 0 };
  const fail = (code: string, message: string): ImportResult => ({
    catalog: null,
    courseOrgs: {},
    issues: [...issues, { severity: "error", row: null, code, message }],
    stats,
  });
  if (rows.length < 2) return fail("EMPTY_FILE", "헤더와 데이터 행이 필요합니다.");
  if (!cfg.catalogId.trim() || !cfg.termId.trim()) return fail("MISSING_TERM", "카탈로그 ID와 학기 ID를 입력하세요.");

  const header = rows[0].map((h) => h.trim());
  const colIndex: Partial<Record<FieldKey, number>> = {};
  for (const [k, name] of Object.entries(cfg.columns) as [FieldKey, string | undefined][]) {
    if (!name) continue;
    const i = header.indexOf(name);
    if (i < 0) return fail("COLUMN_NOT_FOUND", `매핑한 열 '${name}'이(가) 파일에 없습니다.`);
    colIndex[k] = i;
  }
  const required: FieldKey[] = ["course_code", "course_name", "section", "credit"];
  if (cfg.timeMode === "day_start_end") required.push("day", "start", "end");
  if (cfg.timeMode === "day_period") required.push("day", "period");
  if (cfg.timeMode === "schedule_text") required.push("schedule");
  const missing = required.filter((k) => colIndex[k] === undefined);
  if (missing.length) return fail("REQUIRED_COLUMN_UNMAPPED", `필수 열 매핑 누락: ${missing.map((k) => FIELD_LABELS[k]).join(", ")}`);
  if (colIndex.delivery_mode === undefined && cfg.defaultDelivery === null)
    return fail("DELIVERY_UNMAPPED", "수업방식 열을 매핑하거나 기본 수업방식을 선택하세요.");

  const byDay = cfg.periodTableByDay && Object.keys(cfg.periodTableByDay).length ? cfg.periodTableByDay : null;
  const tableFor: TableFor = (day) => (byDay ? byDay[day] : cfg.periodTable);

  const get = (r: string[], k: FieldKey) => {
    if (colIndex[k] === undefined) return "";
    const cell = (r[colIndex[k]!] ?? "").trim();
    if (!cell.includes("\n")) return cell;
    const li = cfg.lines?.[k];
    const parts = cell.split("\n").map((x) => x.trim());
    return li === undefined ? parts.join(" ") : (parts[li] ?? "");
  };

  const courses = new Map<string, CourseAcc>();
  const sections = new Map<string, SectionAcc>();
  const instructors = new Map<string, Instructor>();
  const termId = cfg.termId.trim();

  for (let ri = 1; ri < rows.length; ri++) {
    const r = rows[ri];
    const rowNo = ri;
    const code = get(r, "course_code");
    const name = get(r, "course_name");
    const label = get(r, "section");
    if (!code || !name || !label) {
      issues.push({ severity: "error", row: rowNo, code: "ROW_MISSING_KEY", message: "과목코드·과목명·분반 중 빈 값이 있어 행을 건너뜁니다." });
      continue;
    }
    // --- course
    const units = creditToUnits(get(r, "credit"));
    const catLabel = get(r, "category");
    let c = courses.get(code);
    if (!c) {
      c = { id: code, name, units, categoryLabel: catLabel, firstRow: rowNo, bad: false, org: get(r, "org") };
      courses.set(code, c);
      if (units === null) {
        c.bad = true;
        issues.push({ severity: "error", row: rowNo, code: "CREDIT_INVALID", message: `${code}: 학점 '${get(r, "credit")}'을(를) 해석할 수 없습니다(0.01학점 단위까지). 과목을 제외합니다.` });
      }
    } else if (get(r, "org") && c.org && get(r, "org") !== c.org) {
      issues.push({ severity: "warning", row: rowNo, code: "ORG_INCONSISTENT", message: `${code}: 분반마다 개설 소속이 달라 첫 값(${c.org})만 기록했습니다.` });
    }
    if (c && !c.bad && (c.units !== units || c.categoryLabel !== catLabel || c.name !== name)) {
      c.bad = true;
      issues.push({
        severity: "error",
        row: rowNo,
        code: "COURSE_INCONSISTENT",
        message: `${code}: 행마다 과목명·학점·이수구분이 달라 자동 병합하지 않습니다. 과목을 제외합니다.`,
      });
    }

    // --- section
    const sid = `${termId}:${code}:${label}`;
    let s = sections.get(sid);
    if (!s) {
      s = { courseId: code, label, firstRow: rowNo, delivery: null, instructorIds: [], meetings: [], issueCodes: new Set(), timedRows: 0, untimedRows: 0 };
      sections.set(sid, s);
    }

    const rawDelivery = get(r, "delivery_mode");
    const delivery: DeliveryMode | null = rawDelivery ? (DELIVERY_ALIASES[norm(rawDelivery)] ?? DELIVERY_ALIASES[rawDelivery] ?? null) : cfg.defaultDelivery;
    if (delivery === null) s.issueCodes.add("DELIVERY_UNKNOWN");
    else if (s.delivery && s.delivery !== delivery) s.issueCodes.add("DELIVERY_INCONSISTENT");
    else s.delivery = delivery;

    // instructors
    const instNames = get(r, "instructor").split(/[,/;]/).map((x) => x.trim()).filter(Boolean);
    const instIds = get(r, "instructor_id").split(/[,/;]/).map((x) => x.trim()).filter(Boolean);
    if (instIds.length && instNames.length && instIds.length !== instNames.length) s.issueCodes.add("INSTRUCTOR_MISMATCH");
    const ids = instIds.length ? instIds : instNames.map((n) => `name:${n}`);
    ids.forEach((id, k) => {
      const nm = instNames[k] ?? id;
      if (!instructors.has(id)) instructors.set(id, { id, name: nm });
      if (!s!.instructorIds.includes(id)) s!.instructorIds.push(id);
    });

    if (get(r, "schedule_note")) s.issueCodes.add("IRREGULAR_SCHEDULE");

    // time
    let parsed: TimeParse | null = null;
    if (cfg.timeMode === "schedule_text") {
      const t = get(r, "schedule");
      if (t) parsed = parseScheduleText(t, tableFor);
    } else {
      const dayText = get(r, "day");
      const a = cfg.timeMode === "day_start_end" ? get(r, "start") : get(r, "period");
      const b = cfg.timeMode === "day_start_end" ? get(r, "end") : "x";
      if (dayText || a || (cfg.timeMode === "day_start_end" && b)) {
        const day = parseDay(dayText);
        if (!day) parsed = { error: "DAY_UNKNOWN" };
        else if (cfg.timeMode === "day_start_end") {
          const st = parseHHMM(a, false);
          const en = parseHHMM(b, true);
          parsed = st === null || en === null || st >= en ? { error: "TIME_FORMAT" } : { meetings: [{ day, start_minute: st, end_minute: en }] };
        } else parsed = periodsToMeetings(day, a, tableFor);
      }
    }
    if (parsed === null) s.untimedRows++;
    else if ("error" in parsed) {
      s.timedRows++;
      s.issueCodes.add(parsed.error);
    } else {
      s.timedRows++;
      const room = get(r, "room") || null;
      for (const m of parsed.meetings) {
        const dup = s.meetings.find((x) => x.day === m.day && x.start_minute === m.start_minute && x.end_minute === m.end_minute);
        if (dup) {
          issues.push({ severity: "warning", row: rowNo, code: "DUPLICATE_MEETING", message: `${sid}: 같은 수업시간 행이 중복되어 하나로 합쳤습니다.` });
          continue;
        }
        s.meetings.push({ ...m, room, campus_required: false });
      }
    }
  }

  // --- finalize sections
  const outSections: Section[] = [];
  for (const [sid, s] of sections) {
    const course = courses.get(s.courseId)!;
    if (course.bad) continue;
    const delivery = s.delivery ?? "in_person";
    if (s.timedRows && s.untimedRows) s.issueCodes.add("PARTIAL_TIME");
    if (!s.meetings.length && !s.issueCodes.size && delivery !== "online_async") s.issueCodes.add("TIME_TBD");
    if (delivery === "online_async" && s.meetings.length) s.issueCodes.add("ASYNC_WITH_TIME");
    for (let i = 0; i < s.meetings.length; i++)
      for (let j = i + 1; j < s.meetings.length; j++) {
        const a = s.meetings[i];
        const b = s.meetings[j];
        if (a.day === b.day && a.start_minute < b.end_minute && b.start_minute < a.end_minute) s.issueCodes.add("INTRA_SECTION_OVERLAP");
      }
    const unsupported = s.issueCodes.size > 0;
    const meetings = unsupported ? [] : s.meetings.map((m) => ({ ...m, campus_required: delivery === "in_person" }));
    if (unsupported) {
      stats.unsupportedSections++;
      issues.push({
        severity: "warning",
        row: s.firstRow,
        code: "SECTION_UNSUPPORTED",
        message: `${sid}: 지원하지 않는 시간 정보(${[...s.issueCodes].join(", ")})라 시간표 생성에서 제외합니다.`,
      });
    }
    outSections.push({
      id: sid,
      course_id: s.courseId,
      section_label: s.label,
      instructor_ids: s.instructorIds,
      delivery_mode: delivery,
      meetings,
      support_status: unsupported ? "unsupported" : "supported",
      issue_codes: [...s.issueCodes].sort(),
    });
  }

  const outCourses: Course[] = [];
  for (const c of courses.values()) {
    if (c.bad) {
      stats.excludedCourses++;
      continue;
    }
    const catId = c.categoryLabel ? (cfg.categoryMap[c.categoryLabel] ?? c.categoryLabel) : null;
    outCourses.push({ id: c.id, name: c.name, credit_units: c.units!, category_ids: catId ? [catId] : [], equivalence_group_id: null });
  }
  const usedInstructors = new Set(outSections.flatMap((s) => s.instructor_ids));
  if ([...instructors.keys()].some((k) => k.startsWith("name:")))
    issues.push({ severity: "warning", row: null, code: "INSTRUCTOR_ID_FROM_NAME", message: "교수 ID 열이 없어 이름으로 식별합니다. 동명이인은 구분되지 않습니다." });

  const catIds = new Set(outCourses.flatMap((c) => c.category_ids));
  const groups: Record<string, string[]> = {};
  for (const [g, cats] of Object.entries(cfg.categoryGroups)) {
    const kept = cats.filter((x) => catIds.has(x));
    if (kept.length) groups[g] = kept;
  }

  stats.courses = outCourses.length;
  stats.sections = outSections.length;
  if (!outSections.length) return fail("NO_SECTIONS", "가져올 수 있는 분반이 없습니다.");
  const catalog: Catalog = {
    schema_version: "1.0",
    catalog_id: cfg.catalogId.trim(),
    term_id: termId,
    timezone: "Asia/Seoul",
    data_origin: cfg.dataOrigin,
    category_groups: groups,
    courses: outCourses.sort((a, b) => a.id.localeCompare(b.id)),
    instructors: [...instructors.values()].filter((i) => usedInstructors.has(i.id)).sort((a, b) => a.id.localeCompare(b.id)),
    sections: outSections.sort((a, b) => a.id.localeCompare(b.id)),
  };
  const courseOrgs: Record<string, string> = {};
  for (const c of outCourses) {
    const o = courses.get(c.id)?.org;
    if (o) courseOrgs[c.id] = o;
  }
  return { catalog, issues, stats, courseOrgs };
}

/** 데모 샘플 CSV용 설정. 학교 CSV와 같은 importCatalog 경로를 쓴다. */
export const DEMO_ADAPTER: AdapterConfig = {
  catalogId: "demo-campus-2026-2",
  termId: "2026-2",
  dataOrigin: "synthetic",
  columns: {
    course_code: "course_code",
    course_name: "course_name",
    section: "section",
    credit: "credit",
    category: "category",
    instructor_id: "instructor_id",
    instructor: "instructor",
    delivery_mode: "delivery_mode",
    day: "day",
    start: "start",
    end: "end",
    room: "room",
    schedule_note: "schedule_note",
  },
  timeMode: "day_start_end",
  periodTable: {},
  categoryMap: { 전공필수: "major_required", 전공선택: "major_elective", 교양: "general" },
  categoryGroups: { major: ["major_required", "major_elective"] },
  defaultDelivery: null,
};

/** 교시표 기본 예시(학교마다 다르므로 화면에서 반드시 확인·수정). */
export const EXAMPLE_PERIOD_TABLE: Record<string, [number, number]> = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [String(i + 1), [540 + i * 60, 540 + i * 60 + 50] as [number, number]]),
);
