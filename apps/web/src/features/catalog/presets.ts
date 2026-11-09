/**
 * 학교별 import 설정 프리셋. 데이터가 아니라 "변환 규칙"만 담는다(실제 개설강좌 데이터는 저장소에 넣지 않음).
 *
 * 포털 HTML 내보내기(.xls 확장자, CP949) 형식:
 *   구분 | 과목코드 | 분반 | 과목명(CourseName) | 학점 | 개설정보(학부\n교수) | 시간(Period)(한글\n영문) | 강의실 | ...
 * 교시표: 사용자가 제공한 학교 공지 "변경 후" 기준(2026-11-09). 수요일은 현행 유지(변경 전) 시간.
 * 토·일 교시 시간은 자료에 없으므로 넣지 않는다 → 토·일 교시 분반은 PERIOD_TABLE_MISSING_FOR_DAY로 미지원 처리.
 */
import type { AdapterConfig } from "./adapter";

export const PORTAL_PERIOD_TABLE_TEXT = `[월,화,목,금]
1=09:00-10:15
2=10:30-11:45
3=12:00-13:15
4=13:30-14:45
5=15:00-16:15
6=16:30-17:45
7=18:00-19:15
8=19:30-20:45
9=21:00-22:15
10=22:30-23:45
[수]
1=08:30-09:45
2=10:00-11:15
3=11:30-12:45
4=13:30-14:45
5=15:00-16:15
6=16:30-17:45
7=18:00-19:15
8=19:30-20:45
9=21:00-22:15
10=22:30-23:45`;

export const PORTAL_HEADERS = ["구분", "과목코드", "분반", "과목명(CourseName)", "학점", "개설정보", "시간(Period)", "강의실"];

export function matchesPortalExport(headers: string[]): boolean {
  return PORTAL_HEADERS.every((h) => headers.includes(h));
}

/** 열·줄 선택·분류 매핑. 교시표는 PORTAL_PERIOD_TABLE_TEXT를 parsePeriodTables로 읽어 넣는다. */
export const PORTAL_ADAPTER_BASE: Pick<AdapterConfig, "columns" | "lines" | "timeMode" | "defaultDelivery" | "categoryMap" | "categoryGroups"> = {
  columns: {
    course_code: "과목코드",
    course_name: "과목명(CourseName)",
    section: "분반",
    credit: "학점",
    category: "구분",
    instructor: "개설정보",
    schedule: "시간(Period)",
    room: "강의실",
    org: "개설정보",
  },
  // 과목명 1번째 줄(한글), 개설정보 1번째 줄(개설 소속)·2번째 줄(교수), 시간 1번째 줄(한글 표기; 영문 줄은 잘린 경우가 있음)
  lines: { course_name: 0, instructor: 1, schedule: 0, org: 0 },
  timeMode: "schedule_text",
  defaultDelivery: "in_person", // 수업방식 열 없음
  categoryMap: {},
  // '전공' 그룹을 자동으로 만들지 않는다. 전필·전선은 '전공 유형 이수구분'일 뿐, 학생의 내 전공 인정 기준이 아니다.
  // 내 전공 학점은 사용자가 과목 목록을 확인한 뒤에만 계산한다(features/major).
  categoryGroups: {},
};

/** 사용자 확인(2026-11-09): 전공 유형 이수구분 = 전필 + 전선 (자선 제외). 내 전공 인정 여부와는 별개. */
export const PORTAL_MAJOR_TYPE_CATEGORIES = ["전필", "전선"];


