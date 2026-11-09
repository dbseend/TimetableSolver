/** 최소 RFC 4180 CSV/TSV 파서. UTF-8 BOM 제거, 따옴표·이스케이프·CRLF 지원. 외부 의존성 없음. */

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectDelimiter(firstLine: string): "," | "\t" {
  return (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
}

export function parseDelimited(input: string, delimiter?: string): string[][] {
  const text = stripBom(input);
  const delim = delimiter ?? detectDelimiter(text.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** 인코딩: UTF-8로 엄격히 디코드하고 실패하면 null(사용자에게 인코딩 선택/안내). */
export function decodeStrict(buf: ArrayBuffer, encoding = "utf-8"): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}
