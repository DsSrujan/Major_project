"""
routers/advisory.py

Endpoints for AI Advisory, RAG-powered chatbot, and explanation generation
via Groq API and Supabase pgvector.

Includes robust error handling and user-facing pop messages when Groq
free tier token limits or API rate limits are hit.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.rag_service import generate_rag_explanation

logger = logging.getLogger("nutripalm.routers.advisory")

router = APIRouter(
    prefix="/api/advisory",
    tags=["advisory"],
)


class AdvisoryRequest(BaseModel):
    user_query: str = Field(..., description="Farmer or user question or prompt.")
    crop: Optional[str] = Field(None, description="Crop name (e.g. 'Arecanut', 'Coconut').")
    rule_results_summary: Optional[str] = Field(
        "",
        description="Deterministic calculation results (NPK deficit, fertilizer doses, ROI).",
    )
    weather_data: Optional[str] = Field(
        "",
        description="Live Open-Meteo weather details (rainfall forecast, humidity).",
    )


class AdvisoryResponse(BaseModel):
    success: bool
    explanation: Optional[str] = None
    pop_message: Optional[str] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    context_retrieved: bool = False


@router.post(
    "/ask",
    response_model=AdvisoryResponse,
    status_code=status.HTTP_200_OK,
)
def get_ai_advisory(request: AdvisoryRequest) -> AdvisoryResponse:
    """
    Run hybrid RAG + Groq advisory engine.

    If Groq fails (e.g., token limit reached on free API key, timeout, or rate limit),
    this endpoint safely returns success=False along with an informative `pop_message`
    so the frontend can display a user-friendly popup toast instead of crashing.
    """
    # Augment query with crop name if provided
    query = request.user_query
    if request.crop and request.crop.lower() not in query.lower():
        query = f"Crop: {request.crop}. {query}"

    result = generate_rag_explanation(
        user_query=query,
        rule_results_summary=request.rule_results_summary or "",
        weather_data=request.weather_data or "",
        raise_on_error=False,
    )

    if not result.success:
        logger.warning(
            "Advisory generation failed: error_code=%s, pop_message=%s",
            result.error_code,
            result.pop_message,
        )

    return AdvisoryResponse(
        success=result.success,
        explanation=result.explanation,
        pop_message=result.pop_message,
        error=result.error,
        error_code=result.error_code,
        context_retrieved=result.context_retrieved,
    )
