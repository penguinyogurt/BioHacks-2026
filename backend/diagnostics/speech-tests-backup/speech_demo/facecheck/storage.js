const KEY = "facecheck:v2";
export function loadStore() {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {
        baseline: null,
        sessions: []
    };
    try {
        return JSON.parse(raw);
    } catch  {
        return {
            baseline: null,
            sessions: []
        };
    }
}
function saveStore(store) {
    localStorage.setItem(KEY, JSON.stringify(store));
}
export function saveBaseline(session) {
    const store = loadStore();
    store.baseline = session;
    saveStore(store);
}
export function appendSession(session) {
    const store = loadStore();
    store.sessions.push(session);
    saveStore(store);
}
export function clearStore() {
    localStorage.removeItem(KEY);
}
