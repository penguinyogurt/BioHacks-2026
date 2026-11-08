"""The one place a Claude client is built.

Structured output goes through Claude's native structured outputs
(`output_config.format`), never forced tool_choice: Claude Opus 5.5 and
Claude Sonnet 5.5 reject `tool_choice: any/tool` with a 400. So:
  - plain calls:  structured(model, Schema)      (method="json_schema")
  - agents:       ProviderStrategy(Schema)       (see subagent.py)
"""
import os

from langchain_anthropic import ChatAnthropic
from langchain_core.rate_limiters import InMemoryRateLimiter

from agent.config import ANTHROPIC_API_KEY

# Optional requests-per-minute cap per model, shared by every agent in this
# process. Leave unset unless your Anthropic tier is hitting 429s.
# Format: "claude-sonnet-5-5:50,*:50"
_RPM: dict[str, float] = {}
for part in filter(None, os.getenv("AGENT_LLM_RPM", "").split(",")):
    name, _, rpm = part.rpartition(":")
    _RPM[name.strip() or "*"] = float(rpm)
_limiters: dict[str, InMemoryRateLimiter] = {}


def _limiter(model: str) -> InMemoryRateLimiter | None:
    rpm = _RPM.get(model, _RPM.get("*"))
    if not rpm:
        return None
    if model not in _limiters:
        _limiters[model] = InMemoryRateLimiter(requests_per_second=rpm / 60, check_every_n_seconds=0.25, max_bucket_size=1)
    return _limiters[model]


def claude(model: str, effort: str | None = None) -> ChatAnthropic:
    # Thinking is left at its default (adaptive; it can't be disabled on these
    # models). Effort is the depth/speed control. No temperature: rejected.
    return ChatAnthropic(
        model=model,
        api_key=ANTHROPIC_API_KEY,
        max_tokens=16000,
        reasoning_effort=effort or os.getenv("AGENT_EFFORT", "medium"),
        max_retries=4,
        default_request_timeout=300,
        rate_limiter=_limiter(model),
        # Server-side fallback: if a safety classifier declines, the API retries on
        # a model chosen for that refusal category instead of returning a refusal.
        betas=["server-side-fallback-2026-07-01"],
        model_kwargs={"fallbacks": "default"},
    )


def structured(model: str, schema: type, effort: str | None = None):
    return claude(model, effort).with_structured_output(schema, method="json_schema")
