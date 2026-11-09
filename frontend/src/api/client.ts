import type { components } from "../types/api";

export type Health = components["schemas"]["HealthResponse"];

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://localhost:8000";

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${BASE}/health`, { signal });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as Health;
}
