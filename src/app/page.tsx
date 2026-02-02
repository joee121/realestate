/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";


type Msg = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  created_at?: string;
};

type ChatSession = {
  id: string;
  title: string | null;
  created_at?: string;
};

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.trim() || "http://127.0.0.1:8000";

/* =========================
   DB helpers
   ========================= */
async function dbListChats(): Promise<ChatSession[]> {
  const { data, error } = await supabase
    .from("chats")
    .select("id,title,created_at")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as ChatSession[];
}

async function dbCreateChat(title = "New Chat"): Promise<string> {
  const { data, error } = await supabase
    .from("chats")
    .insert({ title })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

async function dbDeleteChat(chatId: string) {
  // delete messages first (FK-safe)
  await supabase.from("messages").delete().eq("chat_id", chatId);
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) throw error;
}

async function dbSetChatTitle(chatId: string, title: string) {
  const { error } = await supabase.from("chats").update({ title }).eq("id", chatId);
  if (error) throw error;
}

async function dbListMessages(chatId: string): Promise<Msg[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id,role,content,sources,created_at")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((r: any) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    sources: (r.sources ?? []) as string[],
    created_at: r.created_at,
  })) as Msg[];
}

async function dbInsertMessage(chatId: string, msg: Msg) {
  const payload = {
    chat_id: chatId,
    role: msg.role,
    content: msg.content,
    sources: msg.sources ?? [],
  };

  const { data, error } = await supabase
    .from("messages")
    .insert(payload)
    .select("id,created_at")
    .single();

  if (error) throw error;
  return data as { id: string; created_at: string };
}

/* =========================
   Page
   ========================= */
export default function Home() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [booting, setBooting] = useState(true);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId),
    [sessions, activeId]
  );

  
  // initial load
  useEffect(() => {
    (async () => {
      try {
        const chats = await dbListChats();
        setSessions(chats);

        // pick first chat or create one
        if (chats.length) {
          setActiveId(chats[0].id);
        } else {
          const id = await dbCreateChat("Welcome Chat");
          setSessions([{ id, title: "Welcome Chat" }]);
          setActiveId(id);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  // load messages whenever activeId changes
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      try {
        const msgs = await dbListMessages(activeId);
        setMessages(msgs);
      } catch (e) {
        console.error(e);
        setMessages([]);
      }
    })();
  }, [activeId]);

  const onNewChat = async () => {
    try {
      const id = await dbCreateChat("New Chat");
      const chats = await dbListChats();
      setSessions(chats);
      setActiveId(id);
    } catch (e) {
      console.error(e);
      alert("Failed to create chat (check RLS/policies).");
    }
  };

  const onDeleteChat = async (id: string) => {
    try {
      await dbDeleteChat(id);
      const chats = await dbListChats();
      setSessions(chats);

      // choose next chat
      if (id === activeId) {
        const nextId = chats[0]?.id ?? "";
        setActiveId(nextId);
        if (!nextId) setMessages([]);
      }
    } catch (e) {
      console.error(e);
      alert("Failed to delete chat (check RLS/policies).");
    }
  };

  const setActiveTitleIfEmpty = async (title: string) => {
    if (!activeId) return;
    const current = sessions.find((s) => s.id === activeId);
    const curTitle = (current?.title ?? "").trim();

    // only set title if empty or default titles
    if (curTitle && curTitle !== "Welcome Chat" && curTitle !== "New Chat") return;

    try {
      await dbSetChatTitle(activeId, title);
      const chats = await dbListChats();
      setSessions(chats);
    } catch (e) {
      console.error(e);
    }
  };

  if (booting) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="appShell">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChat={onNewChat}
        onDelete={onDeleteChat}
      />

      <MainPanel
        activeChatId={activeId}
        chatTitle={active?.title ?? ""}
        messages={messages}
        setMessages={setMessages}
        onSetTitle={setActiveTitleIfEmpty}
      />

      <style jsx global>{styles}</style>
    </div>
  );
}


/* =========================
   Sidebar
   ========================= */
function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNewChat,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        {/* Put your file here: /public/logo.png */}
        <img className="logo" src="/logo.png" alt="Tatweer Misr" />
        <div className="brandText">
          <div className="brandName">Tatweer Misr</div>
          <div className="brandSub">AI Assistant</div>
        </div>
      </div>

      <button className="newChat" onClick={onNewChat}>
        <span className="plus">＋</span>
        NEW CHAT
      </button>

      <div className="navIcons">
        <button className="iconBtn" title="Home" aria-label="Home">
          <HomeIcon />
        </button>
      </div>

      <div className="sectionTitle">Recent</div>

      <div className="chatList">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`chatItem ${s.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
          >
            <div className="chatTitle">{(s.title || "Untitled").trim()}</div>
            <button
              className="dots"
              title="Delete chat"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
            >
              ⋯
            </button>
          </div>
        ))}
      </div>

      <div className="sidebarFooter">
        <div className="betaNote">good luck</div>

        <div className="footerBtns">
          <button className="footerBtn">
            <LogoutIcon /> Logout
          </button>
          <button className="footerBtn">
            <GearIcon /> Settings
          </button>
        </div>
      </div>
    </aside>
  );
}

/* =========================
   Main Panel
   ========================= */
function MainPanel({
  activeChatId,
  chatTitle,
  messages,
  setMessages,
  onSetTitle,
}: {
  activeChatId: string;
  chatTitle: string;
  messages: Msg[];
  setMessages: React.Dispatch<React.SetStateAction<Msg[]>>;
  onSetTitle: (title: string) => void;
}) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  // uploader state (still hits your backend ingest)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadStatus, setUploadStatus] = useState("");

  const isEmpty = messages.length === 0;

  const send = async () => {
    const q = input.trim();
    if (!q || loading || !activeChatId) return;

    // set title (short)
    const title = q.length > 28 ? q.slice(0, 28) + "…" : q;
    onSetTitle(title);

    setInput("");
    setLoading(true);

    // 1) Insert USER message in Supabase
    const optimisticUser: Msg = { role: "user", content: q };
    setMessages((prev) => [...prev, optimisticUser]);

    try {
      await dbInsertMessage(activeChatId, optimisticUser);

      // 2) Ask backend (RAG)
      const res = await fetch(`${API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, k: 5 }),
      });

      const data = await res.json();

      // 3) Insert ASSISTANT message in Supabase
      const assistantMsg: Msg = {
        role: "assistant",
        content: data.answer ?? "",
        sources: data.sources ?? [],
      };

      setMessages((prev) => [...prev, assistantMsg]);
      await dbInsertMessage(activeChatId, assistantMsg);
    } catch (e: any) {
      const errMsg: Msg = {
        role: "assistant",
        content: `Error: ${String(e?.message ?? e)}`,
      };
      setMessages((prev) => [...prev, errMsg]);
      try {
        await dbInsertMessage(activeChatId, errMsg);
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const ingestFiles = async (files: FileList) => {
    setUploadStatus("Uploading…");

    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append("files", f));

    try {
      const res = await fetch(`${API_BASE}/ingest`, {
        method: "POST",
        body: fd,
      });

      const text = await res.text();
      if (!res.ok) {
        setUploadStatus(`Error ${res.status}: ${text}`);
        return;
      }

      let json: any = null;
      try {
        json = JSON.parse(text);
      } catch {
        setUploadStatus("Ingest OK, but server returned non-JSON.");
        return;
      }

      const added = json?.chunks_added ?? 0;
      setUploadStatus(`Indexed ${added} chunks`);
    } catch (e: any) {
      setUploadStatus(`Upload failed: ${String(e?.message ?? e)}`);
    }
  };

  return (
    <main className="main">
      <div className="topRightBadge" title="Tatweer Misr AI">
        <BadgeIcon />
      </div>

      <div className={`centerStage ${isEmpty ? "empty" : "chatting"}`}>
        {isEmpty ? (
          <div className="welcome">
            <h1>Hello Tatweer Misr Guest,</h1>
            <h2>Welcome to AI Assistant</h2>
          </div>
        ) : (
          <MessageList messages={messages} />
        )}

        <div className="inputPillWrap">
          <div className="inputPill">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder={
                chatTitle?.trim()
                  ? `Message "${chatTitle.trim()}"`
                  : "Start a conversation..."
              }
            />

            <button
              className="pillIcon"
              title="Upload brochures"
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadIcon />
            </button>

            <button className="pillIcon" title="Voice (placeholder)">
              <MicIcon />
            </button>

            <button
              className="sendBtn"
              title="Send"
              onClick={send}
              disabled={loading || input.trim().length === 0}
            >
              <SendIcon />
            </button>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.txt,.xlsx"
              style={{ display: "none" }}
              onChange={(e) => {
                const fl = e.target.files;
                if (fl && fl.length) ingestFiles(fl);
                e.currentTarget.value = "";
              }}
            />
          </div>

          {uploadStatus && <div className="uploadStatus">{uploadStatus}</div>}
        </div>
      </div>
    </main>
  );
}

/* =========================
   Message List
   ========================= */
function MessageList({ messages }: { messages: Msg[] }) {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  return (
    <div className="chatArea">
      {messages.map((m, i) => (
        <div key={m.id ?? i} className={`msg ${m.role}`}>
          <div className="msgBubble">
            <div className="msgRole">{m.role}</div>
            <div className="msgText">{m.content}</div>
            {m.sources?.length ? (
              <div className="msgSources">Sources: {m.sources.join(" • ")}</div>
            ) : null}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

/* =========================
   Icons
   ========================= */
function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
function UploadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 16V4m0 0 4 4m-4-4-4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v4a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 18v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M22 2 11 13"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M22 2 15 22l-4-9-9-4 20-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function BadgeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9.5 12.5 11 14l3.5-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function LogoutIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M10 17 5 12l5-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 12h10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 15a7.8 7.8 0 0 0 .1-2l2-1.2-2-3.5-2.3.6a8 8 0 0 0-1.7-1l-.3-2.4H10.8l-.3 2.4a8 8 0 0 0-1.7 1L6.5 8.3l-2 3.5 2 1.2a7.8 7.8 0 0 0 .1 2l-2 1.2 2 3.5 2.3-.6a8 8 0 0 0 1.7 1l.3 2.4h4.4l.3-2.4a8 8 0 0 0 1.7-1l2.3.6 2-3.5-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* =========================
   CSS
   ========================= */
const styles = `
:root{
  --sideW: 310px;
  --bg1: #070000ff;
  --bg2: #666667ff;
  --muted: #6b7280;
  --card: rgba(255,255,255,.92);
  --shadow: 0 18px 50px rgba(0,0,0,.12);
  --border: rgba(0,0,0,.08);
}
*{ box-sizing: border-box; }
html, body{ height: 100%; margin: 0; font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
button{ font-family: inherit; }

.appShell{ height: 100vh; display: flex; overflow: hidden; }

.sidebar{
  width: var(--sideW);
  background: #ffffff;
  border-right: 1px solid rgba(0,0,0,.06);
  padding: 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.brand{ display: flex; gap: 10px; align-items: center; padding: 6px 8px; }
.logo{ width: 44px; height: 44px; object-fit: contain; }
.brandName{ font-weight: 800; font-size: 16px; color: #111; line-height: 1.1; }
.brandSub{ font-size: 12px; color: var(--muted); margin-top: 2px; }

.newChat{
  border: none;
  border-radius: 12px;
  padding: 12px 14px;
  background: #b91c1c;
  color: white;
  font-weight: 700;
  letter-spacing: .02em;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}
.plus{ font-size: 18px; line-height: 1; }

.navIcons{ display: flex; gap: 10px; align-items: center; }
.iconBtn{
  border: none;
  background: #f3f4f6;
  border-radius: 12px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  cursor: pointer;
  color: #111;
}

.sectionTitle{
  font-size: 12px;
  color: var(--muted);
  padding: 2px 6px;
  font-weight: 700;
  text-transform: capitalize;
}

.chatList{ flex: 1; overflow: auto; padding-right: 4px; }
.chatItem{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 10px;
  border-radius: 12px;
  cursor: pointer;
  color: #111;
}
.chatItem:hover{ background: #f7f7f7; }
.chatItem.active{ background: #f1f5f9; }
.chatTitle{
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}
.dots{
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  color: #6b7280;
}

.sidebarFooter{
  border-top: 1px solid rgba(0,0,0,.06);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.betaNote{ font-size: 11px; color: #9ca3af; line-height: 1.5; padding: 0 6px; }
.footerBtns{ display: flex; gap: 10px; }
.footerBtn{
  flex: 1;
  border: none;
  background: #f3f4f6;
  border-radius: 999px;
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  color: #111;
}

/* Main */
.main{
  flex: 1;
  position: relative;
  background: radial-gradient(circle at 25% 20%, rgba(255,255,255,.15), transparent 40%),
              linear-gradient(135deg, var(--bg1), var(--bg2));
  overflow: hidden;
}
.topRightBadge{
  position: absolute;
  top: 18px;
  right: 18px;
  width: 42px;
  height: 42px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgba(255,255,255,.85);
  box-shadow: var(--shadow);
  color: #111;
}

.centerStage{
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 26px;
  padding: 26px;
}
.centerStage.chatting{
  justify-content: flex-end;
  padding-bottom: 34px;
}

.welcome{
  text-align: center;
  color: white;
  text-shadow: 0 10px 30px rgba(0,0,0,.20);
}
.welcome h1{ margin: 0; font-size: 28px; font-weight: 800; }
.welcome h2{ margin: 10px 0 0; font-size: 34px; font-weight: 900; }

/* Chat area */
.chatArea{
  width: min(950px, 100%);
  max-height: 62vh;
  overflow: auto;
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.msg{ display: flex; }
.msg.user{ justify-content: flex-end; }
.msg.assistant{ justify-content: flex-start; }

.msgBubble{
  width: fit-content;
  max-width: 88%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 12px 14px;
  box-shadow: var(--shadow);
}
.msgRole{
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: var(--muted);
  margin-bottom: 6px;
}
.msgText{ white-space: pre-wrap; line-height: 1.55; color: #111; }
.msgSources{ margin-top: 8px; font-size: 12px; color: #374151; }

/* Input pill */
.inputPillWrap{
  width: min(860px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.inputPill{
  width: 100%;
  background: rgba(255,255,255,.92);
  border: 1px solid rgba(255,255,255,.45);
  border-radius: 22px;
  padding: 10px 12px;
  box-shadow: var(--shadow);
  display: flex;
  align-items: center;
  gap: 10px;
}
.inputPill input{
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  padding: 10px 10px;
}
.pillIcon{
  border: none;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: #eef2f7;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: #111;
}
.sendBtn{
  border: none;
  width: 44px;
  height: 44px;
  border-radius: 999px;
  background: #b91c1c;
  cursor: pointer;
  display: grid;
  place-items: center;
  color: white;
}
.sendBtn:disabled{ opacity: .55; cursor: not-allowed; }

.uploadStatus{
  font-size: 12px;
  color: rgba(255,255,255,.9);
  text-shadow: 0 10px 30px rgba(0,0,0,.25);
}

.chatList::-webkit-scrollbar,
.chatArea::-webkit-scrollbar{ width: 10px; }
.chatList::-webkit-scrollbar-thumb,
.chatArea::-webkit-scrollbar-thumb{
  background: rgba(0,0,0,.12);
  border-radius: 99px;
}
`;
