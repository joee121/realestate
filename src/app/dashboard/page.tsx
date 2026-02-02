"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChatSession,
  loadSessions,
  saveSessions,
  clearSessions,
  STORAGE_KEY,
} from "@/lib/chatStore";

function fmtDate(ms?: number) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString();
}

export default function DashboardPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [q, setQ] = useState("");

  // load
  useEffect(() => {
    const s = loadSessions();
    setSessions(s);
    setActiveId(s[0]?.id ?? "");
  }, []);

  // optional: keep dashboard changes saved (if you delete sessions etc.)
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId),
    [sessions, activeId]
  );

  const filtered = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return sessions;

    return sessions.filter((s) => {
      const inTitle = (s.title || "").toLowerCase().includes(k);
      const inMsgs = s.messages.some((m) => (m.content || "").toLowerCase().includes(k));
      return inTitle || inMsgs;
    });
  }, [sessions, q]);

  const totalMsgs = sessions.reduce((sum, s) => sum + (s.messages?.length ?? 0), 0);
  const userMsgs = sessions.reduce(
    (sum, s) => sum + s.messages.filter((m) => m.role === "user").length,
    0
  );
  const assistantMsgs = totalMsgs - userMsgs;
  const lastActivity = sessions[0]?.updatedAt;

  const onClearAll = () => {
    if (!confirm("Delete ALL local chats?")) return;
    clearSessions();
    setSessions([]);
    setActiveId("");
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-4 py-6">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold">Dashboard</h1>
            <p className="text-sm text-white/60">
              Local chats viewer • storage key: <span className="font-mono">{STORAGE_KEY}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/"
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Back to Chat
            </Link>
            <button
              onClick={onClearAll}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500"
            >
              Clear all
            </button>
          </div>
        </div>

        {/* stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Sessions" value={String(sessions.length)} />
          <StatCard label="Messages" value={String(totalMsgs)} />
          <StatCard label="User / Assistant" value={`${userMsgs} / ${assistantMsgs}`} />
          <StatCard label="Last activity" value={fmtDate(lastActivity)} />
        </div>

        {/* main */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
          {/* left: list */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Sessions</div>
              <div className="text-xs text-white/60">{filtered.length} shown</div>
            </div>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title or message…"
              className="mt-3 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none"
            />

            <div className="mt-4 max-h-[60vh] space-y-2 overflow-auto pr-1">
              {filtered.length === 0 ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-white/60">
                  No sessions found.
                </div>
              ) : (
                filtered.map((s) => {
                  const lastMsg = s.messages[s.messages.length - 1]?.content || "";
                  return (
                    <button
                      key={s.id}
                      onClick={() => setActiveId(s.id)}
                      className={`w-full rounded-2xl border border-white/10 p-3 text-left hover:bg-white/10 ${
                        s.id === activeId ? "bg-white/10" : "bg-black/20"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {s.title || "Untitled"}
                          </div>
                          <div className="mt-1 text-xs text-white/60">
                            {s.messages.length} msgs • {fmtDate(s.updatedAt)}
                          </div>
                        </div>
                        <span className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white/70">
                          {s.messages.length}
                        </span>
                      </div>

                      {lastMsg && (
                        <div className="mt-2 line-clamp-2 text-xs text-white/70">
                          {lastMsg}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* right: viewer */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">
                {active ? active.title : "No session selected"}
              </div>
              {active && (
                <div className="text-xs text-white/60">
                  Created: {fmtDate(active.createdAt)}
                </div>
              )}
            </div>

            <div className="h-[70vh] overflow-auto rounded-2xl bg-black/30 p-4">
              {!active ? (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-6 text-sm text-white/70">
                  Pick a session from the left to preview messages.
                </div>
              ) : active.messages.length === 0 ? (
                <div className="text-sm text-white/60">This session has no messages yet.</div>
              ) : (
                <div className="space-y-3">
                  {active.messages.map((m, i) => (
                    <div
                      key={i}
                      className={`max-w-[88%] rounded-2xl border border-white/10 px-3 py-2 ${
                        m.role === "user" ? "ml-auto bg-red-600/15" : "bg-white/5"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-semibold text-white/60">
                          {m.role.toUpperCase()}
                        </div>
                        <div className="text-[11px] text-white/40">
                          {fmtDate(m.ts)}
                        </div>
                      </div>
                      <div className="mt-1 whitespace-pre-wrap text-sm">{m.content}</div>
                      {!!m.sources?.length && (
                        <div className="mt-2 text-xs text-white/60">
                          Sources: {m.sources.join(" • ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs font-semibold text-white/60">{label}</div>
      <div className="mt-2 text-3xl font-extrabold tracking-tight">{value}</div>
      <div className="mt-2 h-1 w-16 rounded-full bg-red-500/60" />
    </div>
  );
}
