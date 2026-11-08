import type { BlendshapeVector, CaptureId } from "./protocol";

export type ExpressionCapture = Record<CaptureId, BlendshapeVector>;

export type Session = {
  capturedAt: string;
  expressions: ExpressionCapture;
};

type Store = {
  baseline: Session | null;
  sessions: Session[];
};

// v2: sessions now include a "neutral" capture. Bumped so old v1 data
// (missing neutral) doesn't crash the comparison code -- it's just dropped.
const KEY = "facecheck:v2";

export function loadStore(): Store {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { baseline: null, sessions: [] };
  try {
    return JSON.parse(raw) as Store;
  } catch {
    return { baseline: null, sessions: [] };
  }
}

function saveStore(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store));
}

export function saveBaseline(session: Session): void {
  const store = loadStore();
  store.baseline = session;
  saveStore(store);
}

export function appendSession(session: Session): void {
  const store = loadStore();
  store.sessions.push(session);
  saveStore(store);
}

export function clearStore(): void {
  localStorage.removeItem(KEY);
}
