-- Enable the pgvector extension to work with embedding vectors
create extension if not exists vector;

-- Create the agronomy knowledge base table
create table if not exists agronomy_knowledge_base (
    id bigserial primary key,
    crop_name text,
    content text not null,
    -- Using 384 dimensions for sentence-transformers/all-MiniLM-L6-v2
    embedding vector(384)
);

-- Create a function to search for relevant chunks using cosine similarity
create or replace function match_agronomy_knowledge (
    query_embedding vector(384),
    match_threshold float,
    match_count int
)
returns table (
    id bigint,
    crop_name text,
    content text,
    similarity float
)
language sql stable
as $$
    select
        id,
        crop_name,
        content,
        1 - (embedding <=> query_embedding) as similarity
    from agronomy_knowledge_base
    where 1 - (embedding <=> query_embedding) > match_threshold
    order by embedding <=> query_embedding
    limit match_count;
$$;
