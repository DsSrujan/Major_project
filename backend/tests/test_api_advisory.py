"""
tests/test_api_advisory.py

End-to-end endpoint tests for POST /api/advisory/ask
Verifies that when Groq runs out of tokens or fails, the API returns
a structured payload containing `pop_message` for UI toasts.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_advisory_endpoint_returns_pop_message_on_token_limit():
    with patch("app.services.rag_service.get_settings") as mock_settings, \
         patch("app.services.rag_service.retrieve_context") as mock_retrieve, \
         patch("app.services.rag_service.requests.post") as mock_post:

        # Mock settings
        settings_mock = MagicMock()
        settings_mock.groq_api_key = "gsk_dummy_key"
        mock_settings.return_value = settings_mock

        mock_retrieve.return_value = ("Sample Agronomy Context", True, None)

        # Simulate Groq 429 Token Limit / Quota Exceeded
        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.text = '{"error": {"message": "Rate limit reached: Limit 6000 TPM", "type": "tokens"}}'
        mock_post.return_value = mock_resp

        payload = {
            "user_query": "What fertilizer should I apply before monsoon?",
            "crop": "Arecanut",
            "rule_results_summary": "Deficit: 50 kg N/ha",
            "weather_data": "Heavy rain forecast in 24 hours"
        }

        response = client.post("/api/advisory/ask", json=payload)
        assert response.status_code == 200

        data = response.json()
        assert data["success"] is False
        assert data["pop_message"] is not None
        assert "token limit reached" in data["pop_message"].lower()
        assert data["error_code"] == "GROQ_TOKEN_LIMIT_EXCEEDED"
