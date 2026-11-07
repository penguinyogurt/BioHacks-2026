import type { BlendshapeVector, ExpressionId } from "./protocol";

export type ExpressionCapture = Record<ExpressionId, BlendshapeVector>;

export type Session = {
  capturedAt: string;
  expressions: ExpressionCapture;
};

type Store = {
  baseline: Session | null;
  sessions: Session[];
};

const KEY = "facecheck:v1";

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
