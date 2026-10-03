import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add backend directory to sys.path to import app modules if needed
sys.path.append(str(Path(__file__).resolve().parent.parent))
from typing import Any
from supabase import create_client, Client

try:
    from sentence_transformers import SentenceTransformer
except ImportError:
    SentenceTransformer: Any = None

# Load environment variables
load_dotenv()


SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

def chunk_markdown(filepath: str) -> list[dict]:
    """Reads the knowledge base and chunks it by '# Crop: '."""
    chunks = []
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split by '# Crop:'
    parts = content.split('# Crop:')
    
    # The first part might be the header before any crop
    intro = parts[0].strip()
    if intro:
        chunks.append({
            "crop_name": "General Context",
            "content": intro
        })
    
    for part in parts[1:]:
        if not part.strip():
            continue
        # The first line usually has the crop name
        lines = part.strip().split('\n')
        crop_name = lines[0].strip()
        
        chunk_content = "# Crop:" + part
        chunks.append({
            "crop_name": crop_name,
            "content": chunk_content.strip()
        })
    
    return chunks

def ingest_to_supabase():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("[ERROR] Missing Supabase credentials in environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).")
        return

    if SentenceTransformer is None:
        print("\n[ERROR] 'sentence-transformers' package is not installed.")
        print("Please install it by running:")
        print("    pip install sentence-transformers\n")
        return

    print("Initializing Supabase client...")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

    print("Loading embedding model (all-MiniLM-L6-v2)...")
    model = SentenceTransformer('all-MiniLM-L6-v2')


    kb_path = Path(__file__).resolve().parent.parent / "docs" / "crop_fertilizer_knowledge_base.md"
    print(f"Reading and chunking markdown from {kb_path}...")
    chunks = chunk_markdown(str(kb_path))
    print(f"Created {len(chunks)} chunks.")

    for i, chunk in enumerate(chunks):
        content = chunk["content"]
        crop_name = chunk["crop_name"]
        print(f"Embedding chunk {i+1}/{len(chunks)}: {crop_name}...")
        
        # Generate embedding
        embedding = model.encode(content).tolist()
        
        # Upsert into Supabase
        data = {
            "crop_name": crop_name,
            "content": content,
            "embedding": embedding
        }
        
        try:
            supabase.table("agronomy_knowledge_base").insert(data).execute()
            print(f"Successfully inserted chunk for {crop_name}")
        except Exception as e:
            print(f"Error inserting {crop_name}: {e}")

if __name__ == "__main__":
    ingest_to_supabase()
