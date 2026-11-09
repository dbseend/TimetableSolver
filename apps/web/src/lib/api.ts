/** API 클라이언트. 모든 경로는 Vite 프록시(/api → FastAPI)를 거친다. 비밀키는 프론트에 없다. */
import type {
  Capabilities,
  Catalog,
  CatalogValidateResponse,
  DefaultCatalogList,
  DefaultCatalogResponse,
  DiagnoseRequest,
  DiagnosisResponse,
  ErrorResponse,
  ParseRequest,
  ParseResponse,
  SolveRequest,
  SolveResponse,
} from "./types";

const BASE = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: { path: string; reason: string }[] = [],
    public requestId: string | null = null,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body: unknown | undefined, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(
      0,
      "NETWORK",
      import.meta.env.DEV
        ? "API 서버에 연결할 수 없습니다. 백엔드(127.0.0.1:8000)가 실행 중인지 확인하세요."
        : "서버에 연결할 수 없어요. 인터넷 연결을 확인하고 잠시 뒤 다시 시도해 주세요.",
    );
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* 비 JSON 응답 */
  }
  if (!res.ok) {
    const er = (data as ErrorResponse | null)?.error;
    if (er) throw new ApiError(res.status, er.code, er.message, er.fields ?? [], er.request_id);
    if (res.status === 502 || res.status === 503 || res.status === 504)
      throw new ApiError(res.status, "HTTP_" + res.status, `서버가 시작 중이거나 잠시 응답하지 않아요. 30초쯤 뒤 다시 시도해 주세요. (HTTP ${res.status})`);
    if (res.status === 401) throw new ApiError(401, "HTTP_401", "접근 비밀번호가 필요해요. 페이지를 새로고침해 다시 로그인해 주세요.");
    throw new ApiError(res.status, "HTTP_" + res.status, `요청 실패 (HTTP ${res.status})`);
  }
  return data as T;
}

export const api = {
  capabilities: (signal?: AbortSignal) => call<Capabilities>("/capabilities", undefined, signal),
  /** 관리자가 변환해 둔 기본 학교 카탈로그 목록·본문(서버가 업로드와 같은 검증을 거친 것만) */
  listCatalogs: (signal?: AbortSignal) => call<DefaultCatalogList>("/catalogs", undefined, signal),
  getCatalog: (id: string, signal?: AbortSignal) => call<DefaultCatalogResponse>(`/catalogs/${encodeURIComponent(id)}`, undefined, signal),
  validateCatalog: (catalog: Catalog, signal?: AbortSignal) => call<CatalogValidateResponse>("/catalog/validate", { catalog }, signal),
  parse: (req: ParseRequest, signal?: AbortSignal) => call<ParseResponse>("/constraints/parse", req, signal),
  solve: (req: SolveRequest, signal?: AbortSignal) => call<SolveResponse>("/solve", req, signal),
  diagnose: (req: DiagnoseRequest, signal?: AbortSignal) => call<DiagnosisResponse>("/diagnose", req, signal),
};
