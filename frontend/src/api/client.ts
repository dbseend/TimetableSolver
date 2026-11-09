import type { components } from "../types/api";

type S = components["schemas"];
export type Health = S["HealthResponse"];
export type Catalog = S["Catalog"];
export type Section = S["Section"];
export type PoolItem = S["PoolItem"];
export type SolveRequest = S["SolveRequest"];
export type SolveResult = S["SolveResult"];
export type Constraint = NonNullable<SolveRequest["constraints"]>[number];

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${BASE}/health`, { signal });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}

/** Throws an Error carrying the API's unified error message. */
export async function postSolve(body: SolveRequest, signal?: AbortSignal): Promise<SolveResult> {
  const res = await fetch(`${BASE}/solve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as S["ErrorResponse"] | null)?.error;
    const where = err?.details?.map((d) => (d as { loc?: unknown[] }).loc?.join(".")).join(", ");
    throw new Error(err ? `${err.message}${where ? ` (${where})` : ""}` : `solve ${res.status}`);
  }
  return data as SolveResult;
}
