/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useMemo, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";
const ADMIN_TOKEN = process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? ""; // optional

type HistoryItem = {
  ts?: string;
  question?: string;
  answer?: string;
  sources?: string[];
  filename_scope?: string | null;
  k?: number;
};

export default function AdminPage() {
  const [files, setFiles] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [status, setStatus] = useState("");
  const [uploadFiles, setUploadFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);

  const adminHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    if (ADMIN_TOKEN) h["X-Admin-Token"] = ADMIN_TOKEN;
    return h;
  }, []);

  const refreshFiles = async () => {
    const res = await fetch(`${API_BASE}/files`);
    const data = await res.json();
    setFiles(Array.isArray(data.files) ? data.files : []);
  };

  const refreshHistory = async () => {
    const res = await fetch(`${API_BASE}/admin/history?limit=200`, {
      headers: adminHeaders,
    });
    if (!res.ok) {
      setStatus(`History error ${res.status}: ${await res.text()}`);
      return;
    }
    const data = await res.json();
    setHistory(Array.isArray(data.items) ? data.items : []);
  };

  useEffect(() => {
    refreshFiles();
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingest = async () => {
    if (!uploadFiles || uploadFiles.length === 0) {
      setStatus("Choose at least one file to upload.");
      return;
    }
    setLoading(true);
    setStatus("Uploading & indexing…");

    try {
      const fd = new FormData();
      Array.from(uploadFiles).forEach((f) => fd.append("files", f));

      const res = await fetch(`${API_BASE}/ingest`, { method: "POST", body: fd });
      if (!res.ok) {
        setStatus(`Ingest error ${res.status}: ${await res.text()}`);
        return;
      }
      const data = await res.json();
      setStatus(`✅ Indexed ${data?.chunks_added ?? 0} chunks`);
      await refreshFiles();
    } catch (e: any) {
      setStatus("Ingest failed: " + (e?.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  };

  const deleteFile = async (filename: string) => {
    if (!confirm(`Delete all indexed chunks for:\n${filename}\n\nThis cannot be undone.`)) return;

    setLoading(true);
    setStatus(`Deleting ${filename}…`);

    try {
      const url = new URL(`${API_BASE}/admin/files`);
      url.searchParams.set("filename", filename);

      const res = await fetch(url.toString(), {
        method: "DELETE",
        headers: adminHeaders,
      });

      if (!res.ok) {
        setStatus(`Delete error ${res.status}: ${await res.text()}`);
        return;
      }

      setStatus(`✅ Deleted ${filename} from index`);
      await refreshFiles();
    } catch (e: any) {
      setStatus("Delete failed: " + (e?.message ?? String(e)));
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!confirm("Clear server chat history?")) return;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/admin/history/clear`, {
        method: "POST",
        headers: adminHeaders,
      });
      if (!res.ok) {
        setStatus(`Clear error ${res.status}: ${await res.text()}`);
        return;
      }
      setStatus("✅ History cleared");
      await refreshHistory();
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={styles.page}>
      <div style={styles.header}>
        <h1 style={{ margin: 0 }}>Tatweer Misr — Admin</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          Upload & manage files + view chat history
        </p>
      </div>

      <div style={styles.grid}>
        {/* Upload */}
        <section style={styles.card}>
          <h2 style={styles.h2}>Upload documents</h2>
          <p style={styles.p}>PDF / TXT / XLSX → indexed and available in chat.</p>
          <input
            type="file"
            multiple
            accept=".pdf,.txt,.xlsx"
            onChange={(e) => setUploadFiles(e.target.files)}
          />
          <button onClick={ingest} disabled={loading} style={styles.btn}>
            {loading ? "Working…" : "Ingest"}
          </button>
        </section>

        {/* Files */}
        <section style={styles.card}>
          <h2 style={styles.h2}>Indexed files</h2>
          <p style={styles.p}>These appear in chat “Scope” and sources.</p>

          <div style={styles.list}>
            {files.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No files indexed yet.</div>
            ) : (
              files.map((f) => (
                <div key={f} style={styles.row}>
                  <div style={{ fontWeight: 600 }}>{f}</div>
                  <button
                    onClick={() => deleteFile(f)}
                    disabled={loading}
                    style={{ ...styles.btn, background: "#8b1e1e" }}
                  >
                    Delete
                  </button>
                </div>
              ))
            )}
          </div>

          <button onClick={refreshFiles} disabled={loading} style={styles.btnAlt}>
            Refresh list
          </button>
        </section>

        {/* History */}
        <section style={{ ...styles.card, gridColumn: "1 / -1" }}>
          <div style={styles.historyHeader}>
            <div>
              <h2 style={styles.h2}>Chat history (server)</h2>
              <p style={styles.p}>Logged from backend /chat calls.</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={refreshHistory} disabled={loading} style={styles.btnAlt}>
                Refresh
              </button>
              <button onClick={clearHistory} disabled={loading} style={styles.btnDanger}>
                Clear
              </button>
            </div>
          </div>

          <div style={styles.history}>
            {history.length === 0 ? (
              <div style={{ opacity: 0.7 }}>No history yet.</div>
            ) : (
              history.map((h, idx) => (
                <div key={idx} style={styles.historyItem}>
                  <div style={styles.historyMeta}>
                    <span style={{ opacity: 0.8 }}>{h.ts ?? "-"}</span>
                    <span style={{ opacity: 0.8 }}>
                      scope: {h.filename_scope ?? "All"} | k={h.k ?? "-"}
                    </span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontWeight: 700 }}>Q:</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{h.question}</div>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontWeight: 700 }}>A:</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{h.answer}</div>
                  </div>
                  {h.sources?.length ? (
                    <div style={{ marginTop: 6, opacity: 0.85 }}>
                      <div style={{ fontWeight: 700 }}>Sources:</div>
                      <div style={{ whiteSpace: "pre-wrap" }}>{h.sources.join(" • ")}</div>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div style={styles.footer}>
        <div style={{ opacity: 0.9 }}>{status}</div>
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 24,
    fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    background: "linear-gradient(135deg, #0b0b12 0%, #120612 100%)",
    color: "rgba(255,255,255,.92)",
  },
  header: {
    maxWidth: 1100,
    margin: "0 auto 18px",
    padding: 16,
    borderRadius: 16,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.12)",
  },
  grid: {
    maxWidth: 1100,
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 14,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    background: "rgba(255,255,255,.08)",
    border: "1px solid rgba(255,255,255,.12)",
  },
  h2: { margin: "0 0 6px" },
  p: { margin: "0 0 10px", opacity: 0.8 },
  btn: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(215, 40, 80, .95)",
    color: "white",
    cursor: "pointer",
  },
  btnAlt: {
    marginTop: 10,
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.10)",
    color: "rgba(255,255,255,.92)",
    cursor: "pointer",
  },
  btnDanger: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.14)",
    background: "#8b1e1e",
    color: "white",
    cursor: "pointer",
  },
  list: { display: "flex", flexDirection: "column", gap: 8, marginTop: 10 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    background: "rgba(0,0,0,.20)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  historyHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 10,
  },
  history: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    maxHeight: 520,
    overflow: "auto",
    paddingRight: 6,
  },
  historyItem: {
    padding: 12,
    borderRadius: 14,
    background: "rgba(0,0,0,.22)",
    border: "1px solid rgba(255,255,255,.10)",
  },
  historyMeta: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    fontSize: 12,
  },
  footer: {
    maxWidth: 1100,
    margin: "14px auto 0",
    padding: 12,
    borderRadius: 14,
    background: "rgba(255,255,255,.06)",
    border: "1px solid rgba(255,255,255,.10)",
  },
};
