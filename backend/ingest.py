import os, sys, glob, uuid
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

import chromadb
from chromadb.config import Settings
from pypdf import PdfReader
from openai import OpenAI

MODEL_EMBED = os.getenv("MODEL_EMBED", "text-embedding-3-small")
CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

client = OpenAI(api_key=OPENAI_API_KEY)
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR, settings=Settings(anonymized_telemetry=False))
collection = chroma_client.get_or_create_collection(name="brochures")

def embed_texts(texts):
    if not texts:
        return []
    resp = client.embeddings.create(model=MODEL_EMBED, input=texts)
    return [d.embedding for d in resp.data]

def chunk_text(text, chunk_size=1200, overlap=200):
    chunks, i, n = [], 0, len(text)
    while i < n:
        chunks.append(text[i:i+chunk_size])
        i += max(1, chunk_size - overlap)
    return chunks

if __name__ == "__main__":
    folder = sys.argv[1] if len(sys.argv) > 1 else "./sample_docs"
    paths = [p for p in glob.glob(os.path.join(folder, "**", "*"), recursive=True) if os.path.isfile(p)]
    print("FOUND FILES:", paths)
    added = 0
    for p in paths:
        name = os.path.basename(p)
        if name.lower().endswith(".pdf"):
            with open(p, "rb") as fh:
                reader = PdfReader(fh)
                pages = [pg.extract_text() or "" for pg in reader.pages]
                text = "\n".join(pages).strip()
        else:
            with open(p, "r", encoding="utf-8", errors="ignore") as fh:
                text = fh.read().strip()
        print(f"PROCESSING {name} — chars: {len(text)}")
        if not text:
            continue
        chunks = chunk_text(text)
        print(f"CHUNKS: {len(chunks)}")
        embeddings = embed_texts(chunks)
        ids = [str(uuid.uuid4()) for _ in chunks]
        metas = [{"filename": name, "chunk": i} for i in range(len(chunks))]
        collection.add(documents=chunks, embeddings=embeddings, metadatas=metas, ids=ids)
        added += len(chunks)
    print({"status": "ok", "chunks_added": added, "collection": "brochures"})
