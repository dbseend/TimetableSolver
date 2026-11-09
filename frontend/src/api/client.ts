import type { components } from "../types/api";

type S = components["schemas"];
export type Health = S["HealthResponse"];
export type Catalog = S["Catalog"];
export type Section = S["Section"];
export type PoolItem = S["PoolItem"];
export type SolveRequest = S["SolveRequest"];
export type SolveResult = S["SolveResult"];
export type Constraint = NonNullable<SolveRequest["constraints"]>[number];
export type ParseRequest = S["ConstraintsParseRequest"];
export type ParseResponse = S["ConstraintsParseResponse"];

/** Error with the API's machine-readable code (e.g. llm_disabled). */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${BASE}/health`, { signal });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as S["ErrorResponse"] | null)?.error;
    const where = err?.details?.map((d) => (d as { loc?: unknown[] }).loc?.join(".")).join(", ");
    const message = err ? `${err.message}${where ? ` (${where})` : ""}` : `${path} ${res.status}`;
    throw new ApiError(err?.code ?? "http_error", message);
  }
  return data as T;
}

export const postSolve = (body: SolveRequest, signal?: AbortSignal) =>
  post<SolveResult>("/solve", body, signal);

export const postParse = (body: ParseRequest, signal?: AbortSignal) =>
  post<ParseResponse>("/constraints/parse", body, signal);
