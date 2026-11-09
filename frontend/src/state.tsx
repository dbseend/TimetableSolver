import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Catalog, PoolItem, SolveResult } from "./api/client";

type Session = {
  catalog: Catalog | null;
  setCatalog: (c: Catalog | null) => void;
  pool: PoolItem[];
  setPool: (p: PoolItem[]) => void;
  constraintsText: string;
  setConstraintsText: (t: string) => void;
  result: SolveResult | null;
  setResult: (r: SolveResult | null) => void;
};

const Ctx = createContext<Session | null>(null);
const KEY = "timetablesolver.session.v1";

// Per-browser convenience only: storage can be unavailable (private mode), so failures are ignored.
function load(): Partial<Session> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Session>;
  } catch {
    return {};
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [saved] = useState(load);
  const [catalog, setCatalog] = useState<Catalog | null>(saved.catalog ?? null);
  const [pool, setPool] = useState<PoolItem[]>(saved.pool ?? []);
  const [constraintsText, setConstraintsText] = useState(saved.constraintsText ?? "[]");
  const [result, setResult] = useState<SolveResult | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ catalog, pool, constraintsText }));
    } catch {
      /* quota or disabled storage: keep working in memory */
    }
  }, [catalog, pool, constraintsText]);

  return (
    <Ctx.Provider
      value={{ catalog, setCatalog, pool, setPool, constraintsText, setConstraintsText, result, setResult }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
