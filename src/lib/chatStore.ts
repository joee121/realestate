// src/lib/chatStore.ts
export type Msg = {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  ts?: number; // message timestamp (ms)
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number; // ms
  updatedAt: number; // ms
  messages: Msg[];
};

export const STORAGE_KEY = "broker_chat_sessions_v1";

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  const parsed = safeParse<ChatSession[]>(localStorage.getItem(STORAGE_KEY));
  if (!parsed || !Array.isArray(parsed)) return [];
  // minimal sanity cleanup
  return parsed
    .filter((s) => s && typeof s.id === "string")
    .map((s) => ({
      id: s.id,
      title: s.title ?? "Untitled",
      createdAt: typeof s.createdAt === "number" ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : Date.now(),
      messages: Array.isArray(s.messages) ? s.messages : [],
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveSessions(sessions: ChatSession[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function clearSessions() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

export function newSession(title = "New Chat"): ChatSession {
  const now = Date.now();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : String(now);

  return {
    id,
    title,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function addMessage(
  sessions: ChatSession[],
  sessionId: string,
  msg: Omit<Msg, "ts">
): ChatSession[] {
  const now = Date.now();
  return sessions.map((s) => {
    if (s.id !== sessionId) return s;
    const messages = [...s.messages, { ...msg, ts: now }];
    return { ...s, messages, updatedAt: now };
  });
}

export function setTitle(
  sessions: ChatSession[],
  sessionId: string,
  title: string
): ChatSession[] {
  const now = Date.now();
  return sessions.map((s) => (s.id === sessionId ? { ...s, title, updatedAt: now } : s));
}
