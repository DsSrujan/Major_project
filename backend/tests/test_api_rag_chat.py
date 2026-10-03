"""
tests/test_api_rag_chat.py

End-to-end tests for:
- POST /api/recommendations/{plot_id}/explain
- POST /api/chat
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_explain_endpoint_successful():
    with patch("app.routers.rag_chat.get_settings") as mock_settings, \
         patch("app.routers.rag_chat.retrieve_context") as mock_rag, \
         patch("app.routers.rag_chat.fetch_live_weather") as mock_weather, \
         patch("app.routers.rag_chat.requests.post") as mock_post:

        settings_mock = MagicMock()
        settings_mock.groq_api_key = "gsk_test_key"
        mock_settings.return_value = settings_mock

        mock_rag.return_value = ("Sample KAU guidelines for Nitrogen.", True, None)
        mock_weather.return_value = "Temp 29C, No rain expected."

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "### 🔬 Agronomic Significance\nNitrogen is essential for vegetative growth."}}]
        }
        mock_post.return_value = mock_resp

        payload = {
            "nutrient": "nitrogen",
            "nutrient_label": "Nitrogen (N)",
            "current_value": 180,
            "unit": "kg/ha",
            "crop": "Arecanut"
        }

        res = client.post("/api/recommendations/plot-1/explain", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "Agronomic Significance" in data["explanation"]
        assert data["nutrient"] == "nitrogen"


def test_explain_endpoint_handles_groq_token_limit():
    with patch("app.routers.rag_chat.get_settings") as mock_settings, \
         patch("app.routers.rag_chat.retrieve_context") as mock_rag, \
         patch("app.routers.rag_chat.fetch_live_weather") as mock_weather, \
         patch("app.routers.rag_chat.requests.post") as mock_post:

        settings_mock = MagicMock()
        settings_mock.groq_api_key = "gsk_test_key"
        mock_settings.return_value = settings_mock

        mock_rag.return_value = ("Sample context", True, None)
        mock_weather.return_value = "Dry weather"

        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.text = '{"error": {"message": "Rate limit reached: Limit 6000 TPM", "type": "tokens"}}'
        mock_post.return_value = mock_resp

        payload = {"nutrient": "potassium", "crop": "Coconut"}
        res = client.post("/api/recommendations/plot-1/explain", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is False
        assert "token limit reached" in data["pop_message"].lower()
        assert data["error_code"] == "GROQ_TOKEN_LIMIT_EXCEEDED"


def test_chat_endpoint_successful():
    with patch("app.routers.rag_chat.get_settings") as mock_settings, \
         patch("app.routers.rag_chat.retrieve_context") as mock_rag, \
         patch("app.routers.rag_chat.fetch_live_weather") as mock_weather, \
         patch("app.routers.rag_chat.requests.post") as mock_post:

        settings_mock = MagicMock()
        settings_mock.groq_api_key = "gsk_test_key"
        mock_settings.return_value = settings_mock

        mock_rag.return_value = ("Mix Urea with MOP just before application.", True, None)
        mock_weather.return_value = "Light rain expected."

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "Yes, you can mix Urea and MOP immediately prior to broadcasting."}}]
        }
        mock_post.return_value = mock_resp

        payload = {
            "plot_id": "plot-1",
            "message": "Can I mix Urea and MOP together?",
            "crop": "Arecanut",
            "history": []
        }

        res = client.post("/api/chat", json=payload)
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert "Urea and MOP" in data["response"]
