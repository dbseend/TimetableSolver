/**
 * 학사 포털이 내보내는 "HTML 표를 .xls 확장자로 저장한 파일" 읽기.
 * 진짜 엑셀 이진(xls/xlsx)은 지원하지 않는다(범용 xlsx는 이번 MVP 범위 밖).
 * 셀 안의 <br>은 줄바꿈("\n")으로 보존해 adapter가 몇 번째 줄을 쓸지 고르게 한다.
 * 문자열은 데이터로만 다룬다(스크립트·주석은 버림, 실행하지 않음).
 */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith("#x")) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith("#")) return String.fromCodePoint(Number(k.slice(1)));
    return ENTITIES[k] ?? m;
  });
}

function cellText(html: string): string {
  const t = decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/ /g, " ");
  return t
    .split("\n")
    .map((l) => l.replace(/[ \t\r]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function looksLikeHtml(text: string): boolean {
  return /<table[\s>]/i.test(text.slice(0, 200_000));
}

/** 가장 행이 많은 <table>을 행렬로. 헤더 행 셀의 줄바꿈은 이어 붙인다("구\n분" → "구분"). */
export function parseHtmlTable(text: string): string[][] {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const tables = clean.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  let best: string[][] = [];
  for (const t of tables) {
    const rows = (t.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((tr) => [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1])));
    const nonEmpty = rows.filter((r) => r.some((c) => c !== ""));
    if (nonEmpty.length > best.length) best = nonEmpty;
  }
  if (best.length) best[0] = best[0].map((h) => h.replace(/\n/g, "").replace(/\s+/g, ""));
  return best;
}

/** 바이트 → 문자열. UTF-8(엄격) → 실패하면 HTML meta charset 또는 EUC-KR(CP949) 시도. 실패 시 null. */
export function decodeTableFile(buf: ArrayBuffer): { text: string; encoding: string } | { error: string } {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0)
    return { error: "엑셀 이진(.xls) 파일은 지원하지 않습니다. 엑셀에서 'CSV UTF-8'로 저장해 올려 주세요." };
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { error: "xlsx(압축) 파일은 지원하지 않습니다. 엑셀에서 'CSV UTF-8'로 저장해 올려 주세요." };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(buf), encoding: "utf-8" };
  } catch {
    /* 다음 후보 */
  }
  const head = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
  const meta = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  const candidates = [...new Set([meta, "euc-kr"].filter(Boolean) as string[])];
  for (const enc of candidates) {
    try {
      return { text: new TextDecoder(enc, { fatal: true }).decode(buf), encoding: enc };
    } catch {
      /* 다음 후보 */
    }
  }
  return { error: "UTF-8 또는 EUC-KR(CP949)로 읽을 수 없습니다. 'CSV UTF-8'로 다시 저장해 주세요." };
}
