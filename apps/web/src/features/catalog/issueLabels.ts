/** 미지원 분반 사유 코드 → 화면 문구. */
export const SECTION_ISSUE_LABEL: Record<string, string> = {
  TIME_TBD: "수업시간 미정",
  PERIOD_TABLE_MISSING_FOR_DAY: "교시표가 없는 요일(토·일 등)",
  IRREGULAR_SCHEDULE: "격주·비정기 비고",
  SCHEDULE_TEXT_UNPARSED: "해석할 수 없는 시간 표기",
  PERIOD_UNKNOWN: "교시표에 없는 교시",
  PERIOD_RANGE: "교시 범위 오류",
  PERIOD_EMPTY: "교시 비어 있음",
  TIME_FORMAT: "시각 형식 오류",
  DAY_UNKNOWN: "요일 해석 불가",
  DELIVERY_UNKNOWN: "수업방식 해석 불가",
  DELIVERY_INCONSISTENT: "행마다 수업방식이 다름",
  PARTIAL_TIME: "일부 행만 시간 있음",
  INTRA_SECTION_OVERLAP: "분반 내부 시간 겹침",
  ASYNC_WITH_TIME: "비동기인데 시간 있음",
  INSTRUCTOR_MISMATCH: "교수 ID·이름 개수 불일치",
};
