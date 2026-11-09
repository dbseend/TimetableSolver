/**
 * IndexedDB 키-값 저장(로컬 전용). 정규화된 이수내역(성적·학번·이름 제외)과 조건 초안만 저장한다.
 * 브라우저 로컬 저장은 암호화된 금고가 아니다. 실패해도 앱은 메모리 상태로 동작한다.
 */
const DB = "timetable-solver";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => reject(r.error);
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}

export const storage = {
  get: <T>(key: string) => tx<T>("readonly", (s) => s.get(key)),
  set: (key: string, value: unknown) => tx("readwrite", (s) => s.put(value, key)),
  clearAll: () => tx("readwrite", (s) => s.clear()),
};
