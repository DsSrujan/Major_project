"""
rag_service.py

Hybrid RAG & Groq LLM Advisory Service for NutriPalm-AI.
Combines deterministic rule-based calculation results with retrieved
Package of Practices agronomy knowledge and live weather conditions.

Features dedicated error handling for Groq's free tier limits (TPM/RPD rate
limits, token exhaustion, authentication, and timeouts) and Supabase vector
retrieval issues, returning clean user-facing pop messages.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Optional

import requests
from supabase import create_client, Client

from app.config import get_settings
from app.exceptions import GroqApiError, RagKnowledgeBaseError

logger = logging.getLogger("nutripalm.rag_service")

# Cache the embedding model in memory to avoid expensive reloads
_embedding_model: Any = None


@dataclass
class RagExplanationResult:
    """Structured response from the RAG & Groq advisory engine."""
    success: bool
    explanation: Optional[str] = None
    pop_message: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    context_retrieved: bool = False
    context_error: Optional[str] = None


def get_embedding_model() -> Any:
    """Lazy-load and cache the all-MiniLM-L6-v2 embedding model."""
    global _embedding_model
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            logger.error("sentence_transformers package is not installed. Run: pip install sentence-transformers")
            raise RagKnowledgeBaseError(
                message="sentence-transformers package not installed on server.",
                pop_message="Agronomy knowledge retrieval requires 'sentence-transformers' package.",
                status_code=500,
                error_code="PACKAGE_MISSING",
            ) from exc

        logger.info("Loading SentenceTransformer model 'all-MiniLM-L6-v2'...")
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _embedding_model



def retrieve_context(
    query: str,
    match_threshold: float = 0.35,
    match_count: int = 3,
) -> tuple[str, bool, Optional[str]]:
    """
    Embeds the query and queries Supabase pgvector for top matching chunks.
    
    Returns:
        (context_string, success_bool, error_message_or_none)
    """
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_service_role_key:
        err = "Supabase URL or service role key is not configured."
        logger.warning(f"RAG retrieval skipped: {err}")
        return ("", False, err)

    try:
        supabase: Client = create_client(
            settings.supabase_url,
            settings.supabase_service_role_key,
        )
        model = get_embedding_model()
        query_embedding = model.encode(query).tolist()

        response = supabase.rpc(
            "match_agronomy_knowledge",
            {
                "query_embedding": query_embedding,
                "match_threshold": match_threshold,
                "match_count": match_count,
            },
        ).execute()

        chunks = response.data or []
        if not chunks:
            logger.info("No matching agronomy knowledge chunks found for query.")
            return ("No specific crop guidelines found in knowledge base.", True, None)

        context_texts = [
            f"--- Context (Crop: {c.get('crop_name', 'General')}, Similarity: {c.get('similarity', 0):.2f}) ---\n{c.get('content', '')}"
            for c in chunks
        ]
        return ("\n\n".join(context_texts), True, None)

    except Exception as exc:
        err_msg = f"Failed to retrieve context from Supabase pgvector: {exc}"
        logger.error(err_msg, exc_info=True)
        return ("", False, err_msg)


def parse_groq_error(response_status: int, response_text: str) -> tuple[str, str, str]:
    """
    Inspects Groq HTTP response and returns (pop_message, error_details, error_code).
    Specialized for free tier token exhaustion and rate limits.
    """
    try:
        data = requests.utils.json.loads(response_text)
        error_obj = data.get("error", {})
        raw_msg = error_obj.get("message", response_text)
        error_type = error_obj.get("type", "")
        error_code_raw = error_obj.get("code", "")
    except Exception:
        raw_msg = response_text
        error_type = ""
        error_code_raw = ""

    # 1. Free tier rate limit or token limit exhausted (HTTP 429)
    if response_status == 429:
        if "token" in raw_msg.lower() or error_type == "tokens":
            pop_message = (
                "Groq response failed: Free API key token limit reached. "
                "Please wait a minute or refresh your Groq API key."
            )
            return (pop_message, raw_msg, "GROQ_TOKEN_LIMIT_EXCEEDED")
        elif "request" in raw_msg.lower() or error_type == "requests":
            pop_message = (
                "Groq response failed: API request rate limit exceeded. "
                "Please slow down and try again shortly."
            )
            return (pop_message, raw_msg, "GROQ_RATE_LIMIT_EXCEEDED")
        else:
            pop_message = (
                "Groq response failed: API rate limit reached on free tier. "
                "Please try again in a few moments."
            )
            return (pop_message, raw_msg, "GROQ_RATE_LIMIT_EXCEEDED")

    # 2. Authentication failure (HTTP 401)
    if response_status == 401:
        pop_message = (
            "Groq response failed: Invalid or expired Groq API key. "
            "Please check GROQ_API_KEY in your .env configuration."
        )
        return (pop_message, raw_msg, "GROQ_AUTH_FAILED")

    # 3. Quota exhausted / Billing restriction (HTTP 402)
    if response_status == 402:
        pop_message = (
            "Groq response failed: Free credit or token quota fully exhausted. "
            "Please use an active Groq API key."
        )
        return (pop_message, raw_msg, "GROQ_QUOTA_EXHAUSTED")

    # 4. Model decommissioned or model not found (HTTP 404)
    if response_status == 404:
        pop_message = (
            "Groq response failed: Requested AI model not found or currently unavailable."
        )
        return (pop_message, raw_msg, "GROQ_MODEL_NOT_FOUND")

    # 5. Groq service overload (HTTP 500, 502, 503, 504)
    if response_status >= 500:
        pop_message = (
            "Groq response failed: Groq AI service is currently overloaded or experiencing downtime. "
            "Please retry shortly."
        )
        return (pop_message, raw_msg, "GROQ_SERVER_ERROR")

    # Generic HTTP failure
    pop_message = f"Groq response failed: API returned status {response_status}."
    return (pop_message, raw_msg, "GROQ_API_ERROR")


def generate_rag_explanation(
    user_query: str,
    rule_results_summary: str = "",
    weather_data: str = "",
    raise_on_error: bool = False,
) -> RagExplanationResult:
    """
    Orchestrates the RAG retrieval and Groq chat completion with fault-tolerant
    error handling and descriptive pop messages.

    Args:
        user_query: The farmer/user's prompt or question.
        rule_results_summary: Deterministic calculation output (NPK deficit, dosages, ROI).
        weather_data: Live weather conditions (Open-Meteo rainfall, temperature).
        raise_on_error: If True, raises GroqApiError instead of returning failure object.

    Returns:
        RagExplanationResult with pop_message and explanation.
    """
    settings = get_settings()
    groq_api_key = settings.groq_api_key

    # Validate API key
    if not groq_api_key or not groq_api_key.strip():
        pop_msg = (
            "Groq response failed: GROQ_API_KEY is not set in backend/.env. "
            "Please configure your free Groq API key."
        )
        logger.error(pop_msg)
        if raise_on_error:
            raise GroqApiError(
                message="Missing GROQ_API_KEY",
                pop_message=pop_msg,
                status_code=500,
                error_code="GROQ_KEY_MISSING",
            )
        return RagExplanationResult(
            success=False,
            pop_message=pop_msg,
            error="Missing GROQ_API_KEY in settings",
            error_code="GROQ_KEY_MISSING",
        )

    # 1. Retrieve Knowledge Base Context (non-fatal if it fails)
    context, context_ok, context_err = retrieve_context(user_query)

    # 2. Build Structured Hybrid Prompt
    system_prompt = (
        "You are NutriPalm-AI, an agritech advisory assistant for South Indian crops.\n"
        "Your task is to provide clear, actionable agronomic advice based on deterministic "
        "soil calculations, Package of Practices guidelines, and live weather.\n\n"
        "=== 1. DETERMINISTIC CALCULATION RESULTS (DO NOT ALTER THE NUMBERS) ===\n"
        f"{rule_results_summary or 'No specific soil calculation data provided.'}\n\n"
        "=== 2. LIVE WEATHER CONDITIONS ===\n"
        f"{weather_data or 'No live weather warnings.'}\n\n"
        "=== 3. RETRIEVED AGRONOMY GUIDELINES (PACKAGE OF PRACTICES) ===\n"
        f"{context or 'General agronomic safety standards apply.'}\n\n"
        "Rules:\n"
        "- Never contradict or alter the deterministic dosages/ROI calculated above.\n"
        "- Give practical timing advice (e.g. avoid fertilizing before expected heavy downpours).\n"
        "- Keep language simple, clear, and farmer-friendly."
    )

    headers = {
        "Authorization": f"Bearer {groq_api_key.strip()}",
        "Content-Type": "application/json",
    }

    # Model candidate list starting with configured model, falling back to active Groq models
    configured_model = getattr(settings, "groq_model", "openai/gpt-oss-120b") or "openai/gpt-oss-120b"
    candidate_models = [configured_model, "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]
    seen = set()
    unique_models = [m for m in candidate_models if not (m in seen or seen.add(m))]

    last_response = None
    explanation_text = None

    for model_name in unique_models:
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_query},
            ],
            "temperature": 0.3,
            "max_tokens": 1024,
        }

        try:
            response = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=15,
            )
            last_response = response

            if response.status_code == 200:
                data = response.json()
                explanation_text = data["choices"][0]["message"]["content"]
                break
            elif response.status_code in {400, 404}:
                # Model decommissioned or not found, try next candidate model
                logger.warning(f"Groq model '{model_name}' returned status {response.status_code}. Trying fallback model...")
                continue
            else:
                # 429 (rate limit) or 401 (auth) or 5xx, break and handle
                break
        except requests.exceptions.RequestException as req_err:
            logger.warning(f"Request failed for model '{model_name}': {req_err}")
            continue

    if explanation_text:
        return RagExplanationResult(
            success=True,
            explanation=explanation_text,
            context_retrieved=context_ok,
            context_error=context_err,
        )

    if last_response is not None:
        pop_msg, err_detail, err_code = parse_groq_error(
            last_response.status_code,
            last_response.text,
        )
        logger.warning(f"Groq API call failed [{last_response.status_code}]: {err_detail}")
        if raise_on_error:
            raise GroqApiError(
                message=err_detail,
                pop_message=pop_msg,
                status_code=last_response.status_code if last_response.status_code == 429 else 502,
                error_code=err_code,
            )
        return RagExplanationResult(
            success=False,
            pop_message=pop_msg,
            error=err_detail,
            error_code=err_code,
            context_retrieved=context_ok,
            context_error=context_err,
        )

    return RagExplanationResult(
        success=False,
        pop_message="Groq response failed: Unable to connect to Groq AI servers.",
        error="All candidate models failed to connect or return a response.",
        error_code="GROQ_CONNECTION_ERROR",
        context_retrieved=context_ok,
        context_error=context_err,
    )

