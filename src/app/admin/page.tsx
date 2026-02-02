/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";



type HistoryItem = {
  ts?: string;
  question?: string;
  answer?: string;
  sources?: string[];
  filename_scope?: string | null;
  k?: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN || "";
const BUCKET = "brochures";

export default function AdminPage() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [status, setStatus] = useState<{ type: "ok" | "err" | "info"; msg: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canUpload = useMemo(() => !!files && files.length > 0 && !uploading, [files, uploading]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch(`${API_BASE}/admin/history?limit=100`, {
        headers: { "x-admin-token": ADMIN_TOKEN },
      });
      const data = await res.json();
      setHistory(data.items || []);
      setStatus({ type: "info", msg: "History loaded." });
    } catch (e: any) {
      console.error(e);
      setStatus({ type: "err", msg: "Failed to load history." });
    } finally {
      setLoadingHistory(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm("Clear history?")) return;
    try {
      const res = await fetch(`${API_BASE}/admin/history/clear`, {
        method: "POST",
        headers: { "x-admin-token": ADMIN_TOKEN },
      });
      if (!res.ok) {
        setStatus({ type: "err", msg: `Clear failed: ${await res.text()}` });
        return;
      }
      setHistory([]);
      setStatus({ type: "ok", msg: "History cleared ✅" });
    } catch (e: any) {
      setStatus({ type: "err", msg: "Clear failed: " + (e?.message || String(e)) });
    }
  };

  useEffect(() => {
    fetchHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadAndIndex = async () => {
    if (!files || files.length === 0) {
      setStatus({ type: "err", msg: "Choose files first." });
      return;
    }

    setUploading(true);
    setStatus({ type: "info", msg: "Uploading to Supabase + Indexing…" });

    try {
      // 1) Upload each file to Supabase Storage
      for (const file of Array.from(files)) {
        const safeName = `${Date.now()}-${file.name}`; // avoid collisions
        const path = safeName;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type || undefined,
        });

        if (upErr) {
          console.error(upErr);
          setStatus({ type: "err", msg: `Supabase upload failed for ${file.name}: ${upErr.message}` });
          setUploading(false);
          return;
        }
      }

      // 2) Send same files to backend /ingest (Chroma indexing)
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("files", f));

      const ingestRes = await fetch(`${API_BASE}/ingest`, { method: "POST", body: fd });

      if (!ingestRes.ok) {
        const err = await ingestRes.text();
        setStatus({ type: "err", msg: `Indexing failed: ${ingestRes.status} ${err}` });
        setUploading(false);
        return;
      }

      const ingestData = await ingestRes.json();
      setStatus({ type: "ok", msg: `✅ Uploaded + Indexed. Chunks added: ${ingestData?.chunks_added ?? 0}` });

      await fetchHistory();
    } catch (e: any) {
      console.error(e);
      setStatus({ type: "err", msg: "Upload/Index failed: " + (e?.message || String(e)) });
    } finally {
      setUploading(false);
    }
  };

  const selectedFiles = useMemo(() => Array.from(files || []), [files]);

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="brand">
          <div className="logoDot" />
          <div>
            <div className="title">Tatweer Misr Admin</div>
            <div className="sub">Upload brochures → Storage + Index → Available in Chat</div>
          </div>
        </div>

        <div className="right">
          <div className="pill">
            <span className="dot" />
            <span>{uploading ? "Working…" : "Ready"}</span>
          </div>
        </div>
      </header>

      <div className="grid">
        {/* LEFT: Upload */}
        <section className="card">
          <div className="cardHead">
            <h2>Upload brochures</h2>
            <p>Supported: PDF, TXT, XLSX</p>
          </div>

          <div className="uploader">
            <label className="filePick">
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.xlsx"
                onChange={(e) => setFiles(e.target.files)}
              />
              <span>Choose files</span>
            </label>

            <div className="fileMeta">
              <div className="metaRow">
                <span className="k">Bucket</span>
                <span className="v">{BUCKET}</span>
              </div>
              <div className="metaRow">
                <span className="k">API</span>
                <span className="v">{API_BASE}</span>
              </div>
            </div>
          </div>

          {selectedFiles.length > 0 && (
            <div className="fileList">
              <div className="fileListHead">
                <span>Selected files</span>
                <span className="count">{selectedFiles.length}</span>
              </div>

              {selectedFiles.map((f) => (
                <div className="fileRow" key={f.name + f.size}>
                  <div className="fileIcon">{iconFor(f.name)}</div>
                  <div className="fileName">
                    <div className="name">{f.name}</div>
                    <div className="size">{prettyBytes(f.size)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="actions">
            <button className="btn primary" onClick={uploadAndIndex} disabled={!canUpload}>
              {uploading ? "Uploading…" : "Upload + Index"}
            </button>

            <button className="btn" onClick={fetchHistory} disabled={loadingHistory}>
              {loadingHistory ? "Loading…" : "Refresh history"}
            </button>

            <button className="btn danger" onClick={clearHistory}>
              Clear history
            </button>
          </div>

          {status && (
            <div className={`alert ${status.type}`}>
              <span className="alertDot" />
              <span>{status.msg}</span>
            </div>
          )}
        </section>

        {/* RIGHT: History */}
        <section className="card">
          <div className="cardHead">
            <h2>Chat history</h2>
            <p>Latest 100 messages from backend log</p>
          </div>

          {loadingHistory ? (
            <div className="empty">Loading…</div>
          ) : history.length === 0 ? (
            <div className="empty">No history yet.</div>
          ) : (
            <div className="history">
              {history.map((item, idx) => (
                <div className="hItem" key={idx}>
                  <div className="hTop">
                    <span className="ts">{item.ts || ""}</span>
                    <span className="sep">•</span>
                    <span className="meta">k={item.k ?? ""}</span>
                    <span className="sep">•</span>
                    <span className="meta">scope={item.filename_scope ?? "all"}</span>
                  </div>

                  <div className="qa">
                    <div className="q">
                      <span className="tag">Q</span>
                      <span>{item.question}</span>
                    </div>
                    <div className="a">
                      <span className="tag">A</span>
                      <span style={{ whiteSpace: "pre-wrap" }}>{item.answer}</span>
                    </div>
                  </div>

                  {!!item.sources?.length && (
                    <div className="sources">
                      <span className="sTag">Sources</span>
                      <span className="sText">{item.sources.join(" • ")}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <style jsx global>{`
        :root {
          --bg: #0b0d12;
          --card: rgba(255, 255, 255, 0.92);
          --card2: rgba(255, 255, 255, 0.8);
          --border: rgba(0, 0, 0, 0.08);
          --shadow: 0 18px 50px rgba(0, 0, 0, 0.14);
          --muted: rgba(255, 255, 255, 0.65);
          --text: #0b0d12;
          --red: #b91c1c;
          --green: #16a34a;
          --yellow: #f59e0b;
        }

        html,
        body {
          height: 100%;
          margin: 0;
          font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
          background: radial-gradient(circle at 20% 10%, rgba(255, 255, 255, 0.08), transparent 40%),
            linear-gradient(135deg, #05060a, #151828);
          color: white;
        }

        .wrap {
          max-width: 1200px;
          margin: 0 auto;
          padding: 18px;
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          padding: 14px 16px;
          backdrop-filter: blur(10px);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
          margin-bottom: 14px;
        }

        .brand {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .logoDot {
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: linear-gradient(135deg, #ff2d55, #ff7a18);
          box-shadow: 0 10px 30px rgba(255, 45, 85, 0.25);
        }

        .title {
          font-weight: 900;
          letter-spacing: 0.02em;
        }

        .sub {
          font-size: 12px;
          color: var(--muted);
          margin-top: 3px;
        }

        .right {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .pill {
          display: inline-flex;
          gap: 10px;
          align-items: center;
          border-radius: 999px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          font-size: 13px;
          color: rgba(255, 255, 255, 0.86);
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--green);
          box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.15);
        }

        .grid {
          display: grid;
          grid-template-columns: 420px 1fr;
          gap: 14px;
        }

        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }

        .card {
          background: var(--card);
          color: var(--text);
          border: 1px solid var(--border);
          border-radius: 18px;
          box-shadow: var(--shadow);
          padding: 16px;
        }

        .cardHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 12px;
        }

        .cardHead h2 {
          margin: 0;
          font-size: 18px;
          letter-spacing: 0.01em;
        }

        .cardHead p {
          margin: 0;
          font-size: 12px;
          opacity: 0.65;
        }

        .uploader {
          display: grid;
          gap: 12px;
        }

        .filePick {
          position: relative;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          height: 44px;
          border-radius: 14px;
          cursor: pointer;
          border: 1px dashed rgba(0, 0, 0, 0.18);
          background: rgba(0, 0, 0, 0.02);
          font-weight: 700;
        }

        .filePick input {
          position: absolute;
          inset: 0;
          opacity: 0;
          cursor: pointer;
        }

        .fileMeta {
          background: var(--card2);
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 14px;
          padding: 10px 12px;
        }

        .metaRow {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 6px 0;
          font-size: 12px;
        }

        .metaRow .k {
          opacity: 0.65;
        }

        .metaRow .v {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
            "Courier New", monospace;
          font-size: 11px;
          opacity: 0.9;
          max-width: 260px;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .fileList {
          margin-top: 12px;
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          overflow: hidden;
        }

        .fileListHead {
          display: flex;
          justify-content: space-between;
          padding: 10px 12px;
          background: rgba(0, 0, 0, 0.04);
          font-size: 12px;
          font-weight: 800;
        }

        .count {
          opacity: 0.65;
          font-weight: 700;
        }

        .fileRow {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
          background: rgba(255, 255, 255, 0.55);
        }

        .fileIcon {
          width: 34px;
          height: 34px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.06);
          font-weight: 900;
          letter-spacing: 0.04em;
        }

        .fileName .name {
          font-size: 13px;
          font-weight: 800;
        }

        .fileName .size {
          font-size: 12px;
          opacity: 0.65;
          margin-top: 2px;
        }

        .actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 12px;
        }

        .btn {
          height: 44px;
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: white;
          cursor: pointer;
          font-weight: 800;
        }

        .btn:hover {
          filter: brightness(0.98);
        }

        .btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .btn.primary {
          background: #0b0d12;
          color: white;
          border: 0;
        }

        .btn.danger {
          background: var(--red);
          color: white;
          border: 0;
          grid-column: 1 / -1;
        }

        .alert {
          margin-top: 12px;
          padding: 10px 12px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: rgba(255, 255, 255, 0.7);
          font-size: 13px;
        }

        .alertDot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: var(--yellow);
        }

        .alert.ok .alertDot {
          background: var(--green);
        }
        .alert.err .alertDot {
          background: var(--red);
        }

        .empty {
          padding: 16px;
          border-radius: 14px;
          border: 1px dashed rgba(0, 0, 0, 0.2);
          background: rgba(0, 0, 0, 0.02);
          color: rgba(0, 0, 0, 0.65);
        }

        .history {
          display: grid;
          gap: 10px;
          max-height: 70vh;
          overflow: auto;
          padding-right: 6px;
        }

        .hItem {
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 16px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.7);
        }

        .hTop {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          font-size: 12px;
          opacity: 0.7;
        }

        .ts {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
            monospace;
        }

        .sep {
          opacity: 0.5;
        }

        .qa {
          margin-top: 10px;
          display: grid;
          gap: 10px;
        }

        .q,
        .a {
          display: grid;
          grid-template-columns: 26px 1fr;
          gap: 10px;
          align-items: start;
          font-size: 14px;
          line-height: 1.5;
        }

        .tag {
          width: 26px;
          height: 26px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          background: rgba(0, 0, 0, 0.07);
          font-weight: 900;
          font-size: 12px;
        }

        .sources {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          align-items: start;
          font-size: 12px;
          opacity: 0.8;
        }

        .sTag {
          padding: 6px 10px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.07);
          font-weight: 800;
        }

        .sText {
          padding-top: 6px;
        }

        .history::-webkit-scrollbar {
          width: 10px;
        }
        .history::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.12);
          border-radius: 999px;
        }
      `}</style>
    </div>
  );
}

function iconFor(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "PDF";
  if (n.endsWith(".txt")) return "TXT";
  if (n.endsWith(".xlsx")) return "XLSX";
  return "FILE";
}

function prettyBytes(bytes: number) {
  if (!Number.isFinite(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
