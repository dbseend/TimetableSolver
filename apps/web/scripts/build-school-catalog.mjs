#!/usr/bin/env node
/**
 * 관리자용: 학교 개설강좌 파일 → 정규화된 기본 학교 Catalog(JSON) + 메타데이터.
 *
 * 화면의 '파일 직접 올리기'와 **같은 변환 코드**(src/features/catalog의 decodeTableFile·parseHtmlTable·importCatalog,
 * 포털 프리셋·사용자 확인 교시표)를 Vite로 불러와 실행한다. 서버 검증은 백엔드가 이 파일을 읽을 때 다시 한다.
 *
 * 사용(경로는 모두 인자로, 코드에 절대경로 없음):
 *   node scripts/build-school-catalog.mjs <입력파일> --out <출력폴더> --term 2026-2 --as-of 2026-11-09 [--id school-2026-2] [--label "2026-2학기"]
 * 기본 출력 폴더는 저장소의 local-data/catalogs(Git 제외).
 * 출력: <id>.catalog.json(서버 계약 Catalog), <id>.meta.json(기준일·출처·통계·제외 사유·개설 소속 등)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(webRoot, "../..");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const input = args._[0];
const term = args.term;
const asOf = args["as-of"] ?? null;
if (!input || !term) {
  console.error("사용법: node scripts/build-school-catalog.mjs <입력파일> --term <학기ID> [--as-of YYYY-MM-DD] [--out 폴더] [--id ID] [--label 이름]");
  process.exit(2);
}
if (asOf !== null && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error("--as-of는 YYYY-MM-DD 형식이어야 합니다(모르면 생략 → '기준일 미확인').");
  process.exit(2);
}
const id = args.id ?? `school-${term}`;
if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
  console.error("--id는 영문·숫자·._- 만 사용할 수 있습니다.");
  process.exit(2);
}
const outDir = resolve(args.out ?? resolve(repoRoot, "local-data", "catalogs"));
const label = args.label ?? `${term} 학기`;

const server = await createServer({ configFile: false, root: webRoot, logLevel: "error", server: { middlewareMode: true, hmr: false }, appType: "custom" });
try {
  const { decodeTableFile, looksLikeHtml, parseHtmlTable } = await server.ssrLoadModule("/src/features/catalog/htmlTable.ts");
  const { importCatalog, parsePeriodTables } = await server.ssrLoadModule("/src/features/catalog/adapter.ts");
  const { parseDelimited } = await server.ssrLoadModule("/src/features/catalog/csv.ts");
  const presets = await server.ssrLoadModule("/src/features/catalog/presets.ts");

  const buf = readFileSync(resolve(input));
  const dec = decodeTableFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if ("error" in dec) throw new Error(dec.error);
  const rows = looksLikeHtml(dec.text) ? parseHtmlTable(dec.text) : parseDelimited(dec.text);
  if (!rows.length || !presets.matchesPortalExport(rows[0].map((h) => h.trim()))) {
    throw new Error("포털 내보내기 형식(구분·과목코드·분반·과목명(CourseName)·학점·개설정보·시간(Period)·강의실)만 지원합니다. 다른 형식은 화면의 '파일 직접 올리기'에서 열 매핑을 확인하세요.");
  }
  const t = parsePeriodTables(presets.PORTAL_PERIOD_TABLE_TEXT);
  if (t.errors.length) throw new Error(`교시표 오류: ${t.errors.join(" | ")}`);
  const cfg = { ...presets.PORTAL_ADAPTER_BASE, catalogId: id, termId: term, dataOrigin: "user_import", periodTable: t.common, periodTableByDay: t.byDay };
  const r = importCatalog(rows, cfg);
  if (!r.catalog) throw new Error(`변환 실패: ${r.issues.filter((i) => i.severity === "error").map((i) => i.message).join(" / ")}`);

  const c = r.catalog;
  const unsupported = c.sections.filter((s) => s.support_status !== "supported");
  const reasons = {};
  for (const s of unsupported) for (const code of s.issue_codes) reasons[code] = (reasons[code] ?? 0) + 1;
  const issueCounts = {};
  for (const i of r.issues) issueCounts[`${i.severity}:${i.code}`] = (issueCounts[`${i.severity}:${i.code}`] ?? 0) + 1;
  const meta = {
    id,
    term_id: term,
    label,
    as_of: asOf,
    source_file: basename(input),
    generated_at: new Date().toISOString(),
    period_table_basis: "사용자 확인 학교 공지 '변경 후' 기준(요일별, 수요일 1~3교시 별도, 토·일 없음, 교시별 구간)",
    major_type_categories: presets.PORTAL_MAJOR_TYPE_CATEGORIES,
    course_orgs: r.courseOrgs,
    import_summary: { rows: r.stats.rows, courses: c.courses.length, sections: c.sections.length, unsupported_sections: unsupported.length, excluded_courses: r.stats.excludedCourses, exclusion_reasons: reasons, issue_counts: issueCounts },
    import_issues: r.issues.filter((i) => i.code !== "SECTION_UNSUPPORTED").slice(0, 500),
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `${id}.catalog.json`), JSON.stringify(c), "utf-8");
  writeFileSync(resolve(outDir, `${id}.meta.json`), JSON.stringify(meta, null, 1), "utf-8");
  console.log(`wrote ${id}: courses ${c.courses.length}, sections ${c.sections.length}, supported ${c.sections.length - unsupported.length}, unsupported ${unsupported.length} → ${outDir}`);
} finally {
  await server.close();
}
