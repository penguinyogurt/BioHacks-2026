"""Settings, read once from agent/.env. Import this before any LangChain module
so the LANGSMITH_* variables are in the environment when tracing initialises."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "agent" / ".env")

DATA = ROOT / "data"
PATIENT_PATH = Path(os.getenv("PATIENT_PATH", DATA / "patient" / "alex.json"))
PIPELINE_PATH = DATA / "pipeline.json"
RUNS_DIR = ROOT / "agent" / "runs"
CACHE_DIR = ROOT / "agent" / "cache"

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
# Preview model ids get retired; check https://ai.google.dev/gemini-api/docs/models
ORCHESTRATOR_MODEL = os.getenv("GEMINI_ORCHESTRATOR_MODEL", "gemini-3.1-pro-preview")
SUBAGENT_MODEL = os.getenv("GEMINI_SUBAGENT_MODEL", "gemini-3-flash-preview")

MAX_SUBAGENTS = int(os.getenv("AGENT_MAX_SUBAGENTS", "6"))
MAX_CONCURRENCY = int(os.getenv("AGENT_MAX_CONCURRENCY", "4"))
MAX_TOOL_CALLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "8"))
SUBAGENT_TIMEOUT_S = float(os.getenv("AGENT_SUBAGENT_TIMEOUT_S", "120"))
RUN_TIMEOUT_S = float(os.getenv("AGENT_RUN_TIMEOUT_S", "300"))

LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "biohacks-als-research")


def tracing_enabled() -> bool:
    return os.getenv("LANGSMITH_TRACING", "").lower() == "true" and bool(os.getenv("LANGSMITH_API_KEY"))
