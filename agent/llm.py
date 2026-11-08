"""The one place a Gemini client is built."""
import os

from langchain_core.rate_limiters import InMemoryRateLimiter
from langchain_google_genai import ChatGoogleGenerativeAI

from agent.config import GOOGLE_API_KEY

# Requests-per-minute caps, shared by every agent in this process. Quotas are
# per model, so each model gets its own bucket. Free tier is ~5 RPM per model;
# paid tiers can leave this unset.  Format: "gemini-3-flash-preview:5,*:10"
_RPM: dict[str, float] = {}
for part in filter(None, os.getenv("AGENT_GEMINI_RPM", "").split(",")):
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


def gemini(model: str) -> ChatGoogleGenerativeAI:
    # Preview models are served only on v1beta; the library's default can pick v1 and 404.
    return ChatGoogleGenerativeAI(model=model, google_api_key=GOOGLE_API_KEY, api_version="v1beta", max_retries=4, timeout=90, rate_limiter=_limiter(model))
