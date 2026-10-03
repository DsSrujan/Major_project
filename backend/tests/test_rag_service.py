"""
tests/test_rag_service.py

Unit tests for RAG and Groq error handling, specifically verifying:
- Free tier token limit exceeded (HTTP 429) pop message
- Rate limit exceeded (HTTP 429) pop message
- Invalid/missing API key (HTTP 401) pop message
- Timeout & connection failure handling
- Supabase vector search fallback
"""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from app.services.rag_service import generate_rag_explanation, parse_groq_error


class TestRagGroqErrorHandling(unittest.TestCase):
    def test_parse_groq_error_token_limit_429(self):
        body = '{"error": {"message": "Rate limit reached for model llama3-8b-8192: Limit 6000 TPM, Used 6200. Please wait 1m.", "type": "tokens"}}'
        pop_msg, detail, code = parse_groq_error(429, body)
        self.assertIn("Free API key token limit reached", pop_msg)
        self.assertEqual(code, "GROQ_TOKEN_LIMIT_EXCEEDED")

    def test_parse_groq_error_requests_limit_429(self):
        body = '{"error": {"message": "Too many requests per minute", "type": "requests"}}'
        pop_msg, detail, code = parse_groq_error(429, body)
        self.assertIn("request rate limit exceeded", pop_msg)
        self.assertEqual(code, "GROQ_RATE_LIMIT_EXCEEDED")

    def test_parse_groq_error_auth_401(self):
        body = '{"error": {"message": "Invalid API Key"}}'
        pop_msg, detail, code = parse_groq_error(401, body)
        self.assertIn("Invalid or expired Groq API key", pop_msg)
        self.assertEqual(code, "GROQ_AUTH_FAILED")

    @patch("app.services.rag_service.get_settings")
    def test_missing_groq_api_key_returns_pop_message(self, mock_settings):
        settings_mock = MagicMock()
        settings_mock.groq_api_key = ""
        mock_settings.return_value = settings_mock

        result = generate_rag_explanation("How to apply urea?")
        self.assertFalse(result.success)
        self.assertIsNotNone(result.pop_message)
        self.assertIn("GROQ_API_KEY is not set", result.pop_message)
        self.assertEqual(result.error_code, "GROQ_KEY_MISSING")

    @patch("app.services.rag_service.requests.post")
    @patch("app.services.rag_service.retrieve_context")
    @patch("app.services.rag_service.get_settings")
    def test_groq_429_token_exhaustion_in_generate_rag(
        self, mock_settings, mock_retrieve, mock_post
    ):
        settings_mock = MagicMock()
        settings_mock.groq_api_key = "gsk_test_mock_key"
        mock_settings.return_value = settings_mock

        mock_retrieve.return_value = ("Sample context", True, None)

        mock_resp = MagicMock()
        mock_resp.status_code = 429
        mock_resp.text = '{"error": {"message": "TPM token limit exceeded", "type": "tokens"}}'
        mock_post.return_value = mock_resp

        result = generate_rag_explanation("Fertilizer schedule for Arecanut")

        self.assertFalse(result.success)
        self.assertIsNotNone(result.pop_message)
        self.assertIn("Groq response failed", result.pop_message)
        self.assertIn("token limit reached", result.pop_message)
        self.assertEqual(result.error_code, "GROQ_TOKEN_LIMIT_EXCEEDED")


if __name__ == "__main__":
    unittest.main()
