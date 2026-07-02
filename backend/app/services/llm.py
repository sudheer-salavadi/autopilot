"""Model access layer — bring-your-own-model first.

Resolution order for the primary model:
  1. AI_BASE_URL — any OpenAI-compatible endpoint (LM Studio, Ollama, vLLM,
     OpenRouter, ...) + AI_MODEL. This is the intended path for running
     Autopilot entirely on infrastructure you control, no cloud key needed.
  2. OPENAI_API_KEY — zero-config default so the app works out of the box
     without picking a local model first. Not a hard requirement.

GEMINI_API_KEY is a secondary fallback used only when the primary call
fails (rate limit, outage, etc.) — never the primary path.

This module is the only place that constructs model clients. Callers
(evaluator, chat, demo/simulate) go through ai_chat() and embedding_client()
rather than talking to openai.AsyncOpenAI directly, so a new provider only
needs to be wired in here.
"""
import json
import logging
import re
from typing import Tuple

from openai import AsyncOpenAI, BadRequestError, RateLimitError

from app.config import settings

logger = logging.getLogger(__name__)


def _make_openai(base_url: str | None = None, api_key: str = "", timeout: int | None = None) -> AsyncOpenAI:
    kwargs: dict = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    if timeout is not None:
        kwargs["timeout"] = timeout
    return AsyncOpenAI(**kwargs)


def _custom_base_url() -> str:
    return settings.AI_BASE_URL or settings.LM_STUDIO_URL


def primary_client() -> Tuple[AsyncOpenAI, str, bool]:
    """Returns (client, chat_model, is_local). Prefers AI_BASE_URL when set."""
    base_url = _custom_base_url()
    if base_url:
        return (
            _make_openai(
                base_url=base_url,
                api_key=settings.AI_API_KEY or "local",
                timeout=settings.AI_TIMEOUT or settings.LM_STUDIO_TIMEOUT,
            ),
            settings.AI_MODEL or settings.LM_STUDIO_MODEL or "local-model",
            True,
        )
    return _make_openai(api_key=settings.OPENAI_API_KEY), "gpt-5-nano-2025-08-07", False


def embedding_client() -> Tuple[AsyncOpenAI, str] | None:
    """Returns (client, embedding_model), or None if nothing is configured.

    Uses the same BYO endpoint as primary_client() when set, so a fully local
    deployment (e.g. Ollama for both chat and embeddings) needs no cloud key
    at all. Falls back to OpenAI's embeddings endpoint otherwise.
    """
    base_url = _custom_base_url()
    if base_url:
        client = _make_openai(
            base_url=base_url,
            api_key=settings.AI_API_KEY or "local",
            timeout=settings.AI_TIMEOUT or settings.LM_STUDIO_TIMEOUT,
        )
        return client, settings.AI_EMBEDDING_MODEL
    if settings.OPENAI_API_KEY:
        return _make_openai(api_key=settings.OPENAI_API_KEY), settings.AI_EMBEDDING_MODEL
    return None


def _parse_json(text: str) -> dict:
    """Extract JSON from a response that may be wrapped in markdown code blocks."""
    text = text.strip()
    # Strip ```json ... ``` or ``` ... ```
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return json.loads(text)


async def ai_chat(
    messages: list[dict],
    temperature: float = 0.3,
    json_mode: bool = True,
) -> str:
    """Call the primary AI model and return the content string.

    Falls back to Gemini (via its OpenAI-compatible endpoint) if the primary
    call fails and GEMINI_API_KEY is configured.
    Set json_mode=False for plain-text responses (e.g. chat).
    """
    client, model, is_local = primary_client()
    kwargs = {} if is_local or not json_mode else {"response_format": {"type": "json_object"}}
    logger.info("AI call → model=%s", model)
    try:
        response = await client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=temperature,
            **kwargs,
        )
        logger.info("AI call ✓ model=%s", model)
        return response.choices[0].message.content
    except BadRequestError as e:
        # Some models (e.g. gpt-5-nano, o-series) only support default temperature.
        # Retry once without the temperature parameter.
        if "temperature" in str(e) and "unsupported_value" in str(e):
            logger.info("Model %s does not support temperature=%.1f, retrying with default", model, temperature)
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                **kwargs,
            )
            logger.info("AI call ✓ model=%s (default temperature)", model)
            return response.choices[0].message.content
        logger.warning("AI call failed for model %s: %s", model, e)
        if not settings.GEMINI_API_KEY:
            raise
        logger.info("Falling back to Gemini (%s)", settings.GEMINI_MODEL)
    except RateLimitError as e:
        logger.warning("AI rate limit / quota exceeded for model %s: %s", model, e)
        if not settings.GEMINI_API_KEY:
            raise
        logger.info("Falling back to Gemini (%s)", settings.GEMINI_MODEL)
    except Exception as e:
        logger.warning("AI call failed for model %s: %s", model, e)
        if not settings.GEMINI_API_KEY:
            raise
        logger.info("Falling back to Gemini (%s)", settings.GEMINI_MODEL)

    gemini = _make_openai(
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key=settings.GEMINI_API_KEY,
    )
    logger.info("AI call → model=%s (Gemini fallback)", settings.GEMINI_MODEL)
    gemini_kwargs: dict = {} if not json_mode else {"response_format": {"type": "json_object"}}
    try:
        response = await gemini.chat.completions.create(
            model=settings.GEMINI_MODEL,
            messages=messages,
            temperature=temperature,
            **gemini_kwargs,
        )
        logger.info("AI call ✓ model=%s (Gemini fallback)", settings.GEMINI_MODEL)
        return response.choices[0].message.content
    except RateLimitError as e:
        logger.error("Gemini rate limit / quota exceeded: %s", e)
        raise
    except Exception as e:
        logger.error("Gemini fallback also failed: %s", e)
        raise
