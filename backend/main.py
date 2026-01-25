from __future__ import annotations

import os, io, uuid, traceback, re, json
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from typing_extensions import Annotated

from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

# --- fastapi ---
from fastapi import FastAPI, UploadFile, File, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# --- data/RAG ---
import chromadb
from chromadb.config import Settings
from pypdf import PdfReader

# --- excel ---
import openpyxl

# --- web search ---
import requests

# --- models ---
USE_LOCAL_EMBED = os.getenv("USE_LOCAL_EMBED", "false").lower() == "true"
MODEL_CHAT = os.getenv("MODEL_CHAT", "gpt-4o-mini")
MODEL_EMBED = os.getenv("MODEL_EMBED", "text-embedding-3-small")

# --- behavior flags ---
ALLOW_GENERAL_CHAT = os.getenv("ALLOW_GENERAL_CHAT", "true").lower() == "true"
ENABLE_WEB_SEARCH = os.getenv("ENABLE_WEB_SEARCH", "false").lower() == "true"
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

if USE_LOCAL_EMBED:
    from sentence_transformers import SentenceTransformer
    _st_model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    def embed_texts(texts: List[str]) -> List[List[float]]:
        return _st_model.encode(texts, normalize_embeddings=True).tolist()
else:
    from openai import OpenAI
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY missing. Add it to backend/.env or set USE_LOCAL_EMBED=true.")
    client = OpenAI(api_key=OPENAI_API_KEY)

    def embed_texts(texts: List[str]) -> List[List[float]]:
        resp = client.embeddings.create(model=MODEL_EMBED, input=texts)
        return [d.embedding for d in resp.data]

# ---------- App & DB ----------
BASE_DIR = Path(__file__).parent
CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma")
CHROMA_PATH = str((BASE_DIR / CHROMA_DIR).resolve())

chroma_client = chromadb.PersistentClient(
    path=CHROMA_PATH,
    settings=Settings(anonymized_telemetry=False),
)
collection = chroma_client.get_or_create_collection(name="brochures")

app = FastAPI(title="Tatweer Misr RAG API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # ok for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Admin / History ----------
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")  # set in backend/.env
HISTORY_PATH = BASE_DIR / "chat_history.jsonl"

def require_admin(x_admin_token: str | None):
    # If ADMIN_TOKEN is empty => no auth (local dev)
    if ADMIN_TOKEN and x_admin_token != ADMIN_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized (bad admin token)")

def log_chat_event(payload: dict):
    try:
        payload["ts"] = datetime.utcnow().isoformat() + "Z"
        with open(HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        pass

# ---------- Helpers ----------
def chunk_text(text: str, chunk_size: int = 1200, overlap: int = 200) -> List[str]:
    text = (text or "").strip()
    if not text:
        return []
    chunks, i, n = [], 0, len(text)
    step = max(1, chunk_size - overlap)
    while i < n:
        chunks.append(text[i : i + chunk_size])
        i += step
    return chunks

def normalize_cell(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.lower() in {"none", "nan"}:
        return ""
    s = re.sub(r"\s+", " ", s)
    return s

def find_header_row(rows: List[List[Any]]) -> int | None:
    keywords = {"unit", "type", "status", "phase", "price", "delivery", "floor", "bed", "garden", "roof"}
    for i in range(min(50, len(rows))):
        vals = [normalize_cell(x).lower() for x in rows[i]]
        non_empty = [v for v in vals if v]
        if len(non_empty) < 4:
            continue
        if any(any(k in v for k in keywords) for v in non_empty):
            return i
    return None

def excel_to_row_chunks(xlsx_bytes: bytes, filename: str) -> tuple[list[str], list[dict]]:
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), data_only=True)
    chunks: List[str] = []
    metas: List[Dict[str, Any]] = []

    for ws in wb.worksheets:
        raw_rows: List[List[Any]] = []
        for r in ws.iter_rows(values_only=True):
            raw_rows.append(list(r))

        if not raw_rows:
            continue

        header_idx = find_header_row(raw_rows)

        if header_idx is None:
            flat = "\n".join(
                " | ".join(normalize_cell(x) for x in row if normalize_cell(x))
                for row in raw_rows[:300]
            )
            if flat.strip():
                for i, ch in enumerate(chunk_text(f"[Sheet:{ws.title}]\n{flat}", 1200, 200)):
                    chunks.append(ch)
                    metas.append({"filename": filename, "sheet": ws.title, "row": f"text-{i}"})
            continue

        headers = [normalize_cell(h) or f"col_{j}" for j, h in enumerate(raw_rows[header_idx])]

        for ridx in range(header_idx + 1, len(raw_rows)):
            row = raw_rows[ridx]
            if not row:
                continue
            cells = [normalize_cell(c) for c in row]
            if not any(cells):
                continue

            row_dict = {headers[j]: (cells[j] if j < len(cells) else "") for j in range(len(headers))}
            parts = [f"{k}: {v}" for k, v in row_dict.items() if v]
            if not parts:
                continue

            row_text = f"[Sheet: {ws.title}] " + " | ".join(parts)
            chunks.append(row_text)
            metas.append({"filename": filename, "sheet": ws.title, "row": ridx + 1})

    return chunks, metas

def web_search_tavily(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """
    Returns: [{ 'title': str, 'url': str, 'content': str }]
    """
    if not (ENABLE_WEB_SEARCH and TAVILY_API_KEY):
        return []
    try:
        r = requests.post(
            "https://api.tavily.com/search",
            json={
                "api_key": TAVILY_API_KEY,
                "query": query,
                "search_depth": "basic",
                "max_results": max_results,
                "include_answer": False,
                "include_raw_content": False,
            },
            timeout=20,
        )
        r.raise_for_status()
        data = r.json()
        results = data.get("results", []) or []
        out: List[Dict[str, str]] = []
        for item in results:
            out.append({
                "title": (item.get("title") or "").strip(),
                "url": (item.get("url") or "").strip(),
                "content": (item.get("content") or "").strip(),
            })
        return out
    except Exception:
        return []

# ---------- Schemas ----------
class ChatRequest(BaseModel):
    question: str
    k: int = 5
    filename: Optional[str] = None
    use_web: bool = False  # NEW: enable web search for this request

class ChatResponse(BaseModel):
    answer: str
    sources: List[str]

# ---------- Ingest ----------
@app.post("/ingest")
async def ingest(
    files: Annotated[List[UploadFile], File(description="Upload brochures (PDF/TXT/XLSX).")]
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")

    added, errors = 0, []
    for f in files:
        try:
            original_name = f.filename or "unknown"
            fname_lower = original_name.lower()

            if not (fname_lower.endswith(".pdf") or fname_lower.endswith(".txt") or fname_lower.endswith(".xlsx")):
                continue

            content = await f.read()

            chunks: List[str] = []
            metas: List[Dict[str, Any]] = []

            if fname_lower.endswith(".pdf"):
                reader = PdfReader(io.BytesIO(content))
                pages = [p.extract_text() or "" for p in reader.pages]
                text = "\n".join(pages).strip()
                chunks = chunk_text(text)
                metas = [{"filename": original_name, "chunk": i} for i in range(len(chunks))]

            elif fname_lower.endswith(".txt"):
                text = content.decode("utf-8", errors="ignore").strip()
                chunks = chunk_text(text)
                metas = [{"filename": original_name, "chunk": i} for i in range(len(chunks))]

            else:  # .xlsx
                chunks, metas = excel_to_row_chunks(content, original_name)

            if not chunks:
                continue

            embeddings = embed_texts(chunks)
            ids = [str(uuid.uuid4()) for _ in chunks]

            collection.upsert(
                documents=chunks,
                embeddings=embeddings,
                metadatas=metas,
                ids=ids,
            )
            added += len(chunks)

        except Exception as e:
            traceback.print_exc()
            errors.append({"file": f.filename, "error": str(e)[:300]})

    if added == 0 and errors:
        raise HTTPException(status_code=500, detail={"added": added, "errors": errors})
    return {"status": "ok", "chunks_added": added, "errors": errors}

# ---------- List files ----------
@app.get("/files")
def list_files():
    try:
        data = collection.get(include=["metadatas"])
        metas = data.get("metadatas", []) or []
        names = sorted({(m or {}).get("filename", "") for m in metas if (m or {}).get("filename")})
        return {"files": names}
    except Exception as e:
        return {"files": [], "error": str(e)[:200]}

# ---------- Chat (non-streaming) ----------
@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # 1) Retrieve from Chroma
    q_embed = embed_texts([req.question])[0]

    where = None
    if req.filename and req.filename.strip() and req.filename.lower() != "all":
        where = {"filename": req.filename.strip()}

    results = collection.query(
        query_embeddings=[q_embed],
        n_results=req.k,
        include=["documents", "metadatas"],
        where=where,
    )

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]

    rag_blocks, sources = [], []
    for d, m in zip(docs, metas):
        m = m or {}
        if "sheet" in m and "row" in m:
            tag = f"{m.get('filename','')}::{m.get('sheet','')}#row{m.get('row','')}"
        else:
            tag = f"{m.get('filename','')}#chunk{m.get('chunk','')}"
        sources.append(tag)
        rag_blocks.append(f"[{tag}]\n{d}")

    rag_context = "\n\n".join(rag_blocks).strip()

    # 2) Optional web search
    web_blocks: List[str] = []
    web_sources: List[str] = []
    if req.use_web:
        web_results = web_search_tavily(req.question, max_results=5)
        for i, w in enumerate(web_results, start=1):
            url = w.get("url", "").strip()
            if not url:
                continue
            tag = f"web#{i}:{url}"
            snippet = (w.get("content") or "")[:1200]
            web_blocks.append(
                f"[{tag}]\nTitle: {w.get('title','')}\nURL: {url}\nSnippet: {snippet}"
            )
            web_sources.append(tag)

    full_context = "\n\n".join([c for c in [rag_context, "\n\n".join(web_blocks)] if c]).strip()
    if not full_context:
        full_context = "(no retrieved context)"

    all_sources = sources + web_sources

    # 3) Prompt: use RAG/web if relevant; otherwise allow general chat
    system = (
        "You are Tatweer Misr AI Assistant.\n"
        "Rules:\n"
        "1) If brochure/RAG context contains the answer, use it and cite those sources.\n"
        "2) If web context exists and is useful, use it and cite web URLs.\n"
        f"3) If the answer is not in context and ALLOW_GENERAL_CHAT is {'true' if ALLOW_GENERAL_CHAT else 'false'}, "
        "then answer normally from your general knowledge.\n"
        "4) If unsure, say you are unsure.\n"
        "Keep answers concise and structured (bullet points when useful)."
    )

    user = f"Question: {req.question}\n\nContext:\n{full_context}\n\nReturn sources you used."

    from openai import OpenAI
    gen_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    resp = gen_client.chat.completions.create(
        model=MODEL_CHAT,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,
    )
    answer = resp.choices[0].message.content or ""

    log_chat_event({
        "question": req.question,
        "answer": answer,
        "sources": all_sources,
        "filename_scope": req.filename,
        "k": req.k,
        "use_web": req.use_web,
    })

    return ChatResponse(answer=answer, sources=all_sources)

# ---------- Chat (streaming SSE) ----------
@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    q_embed = embed_texts([req.question])[0]

    where = None
    if req.filename and req.filename.strip() and req.filename.lower() != "all":
        where = {"filename": req.filename.strip()}

    results = collection.query(
        query_embeddings=[q_embed],
        n_results=req.k,
        include=["documents", "metadatas"],
        where=where,
    )

    docs = results.get("documents", [[]])[0]
    metas = results.get("metadatas", [[]])[0]

    rag_blocks, sources = [], []
    for d, m in zip(docs, metas):
        m = m or {}
        if "sheet" in m and "row" in m:
            tag = f"{m.get('filename','')}::{m.get('sheet','')}#row{m.get('row','')}"
        else:
            tag = f"{m.get('filename','')}#chunk{m.get('chunk','')}"
        sources.append(tag)
        rag_blocks.append(f"[{tag}]\n{d}")

    rag_context = "\n\n".join(rag_blocks).strip()

    web_blocks: List[str] = []
    web_sources: List[str] = []
    if req.use_web:
        web_results = web_search_tavily(req.question, max_results=5)
        for i, w in enumerate(web_results, start=1):
            url = w.get("url", "").strip()
            if not url:
                continue
            tag = f"web#{i}:{url}"
            snippet = (w.get("content") or "")[:1200]
            web_blocks.append(
                f"[{tag}]\nTitle: {w.get('title','')}\nURL: {url}\nSnippet: {snippet}"
            )
            web_sources.append(tag)

    full_context = "\n\n".join([c for c in [rag_context, "\n\n".join(web_blocks)] if c]).strip()
    if not full_context:
        full_context = "(no retrieved context)"

    all_sources = sources + web_sources

    system = (
        "You are Tatweer Misr AI Assistant.\n"
        "Use brochure/web context if it contains the answer.\n"
        f"If not in context and ALLOW_GENERAL_CHAT is {'true' if ALLOW_GENERAL_CHAT else 'false'}, answer normally.\n"
        "Be concise."
    )
    user = f"Question: {req.question}\n\nContext:\n{full_context}"

    from openai import OpenAI
    gen_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    def gen():
        stream = gen_client.chat.completions.create(
            model=MODEL_CHAT,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.2,
            stream=True,
        )
        out_text: List[str] = []

        for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                out_text.append(delta)
                yield f"data: {delta}\n\n"

        log_chat_event({
            "question": req.question,
            "answer": "".join(out_text),
            "sources": all_sources,
            "filename_scope": req.filename,
            "k": req.k,
            "use_web": req.use_web,
            "stream": True,
        })

        yield f"data: __SOURCES__:{' | '.join(all_sources)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")

# ---------- Admin: History ----------
@app.get("/admin/history")
def admin_history(limit: int = 100, x_admin_token: str | None = Header(default=None)):
    require_admin(x_admin_token)
    if not HISTORY_PATH.exists():
        return {"items": []}

    limit = max(1, min(limit, 1000))
    with open(HISTORY_PATH, "r", encoding="utf-8") as f:
        lines = f.readlines()[-limit:]

    items = []
    for line in reversed(lines):
        try:
            items.append(json.loads(line))
        except Exception:
            continue
    return {"items": items}

@app.post("/admin/history/clear")
def admin_clear_history(x_admin_token: str | None = Header(default=None)):
    require_admin(x_admin_token)
    if HISTORY_PATH.exists():
        HISTORY_PATH.unlink()
    return {"ok": True}

# ---------- Admin: Delete file from index ----------
@app.delete("/admin/files")
def admin_delete_file(filename: str, x_admin_token: str | None = Header(default=None)):
    require_admin(x_admin_token)
    if not filename.strip():
        raise HTTPException(status_code=400, detail="filename is required")

    collection.delete(where={"filename": filename.strip()})
    return {"ok": True, "deleted_for": filename.strip()}

@app.get("/health")
def health():
    return {
        "ok": True,
        "chroma_path": CHROMA_PATH,
        "allow_general_chat": ALLOW_GENERAL_CHAT,
        "enable_web_search": ENABLE_WEB_SEARCH,
        "has_tavily_key": bool(TAVILY_API_KEY),
    }
