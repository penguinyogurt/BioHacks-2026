"""Settings, read once from agent/.env. Import this before any LangChain module
so the LANGSMITH_* variables are in the environment when tracing initialises."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / "agent" / ".env")

DATA = ROOT / "data"
PATIENT_DIR = DATA / "patient"
DEFAULT_PATIENT = os.getenv("DEFAULT_PATIENT", "alex")
PIPELINE_PATH = DATA / "pipeline.json"
RUNS_DIR = ROOT / "agent" / "runs"
CACHE_DIR = ROOT / "agent" / "cache"

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY")
ORCHESTRATOR_MODEL = os.getenv("CLAUDE_ORCHESTRATOR_MODEL", "claude-opus-5-5")
SUBAGENT_MODEL = os.getenv("CLAUDE_SUBAGENT_MODEL", "claude-sonnet-5-5")
INGEST_MODEL = os.getenv("CLAUDE_INGEST_MODEL", ORCHESTRATOR_MODEL)

MAX_SUBAGENTS = int(os.getenv("AGENT_MAX_SUBAGENTS", "8"))
MAX_CONCURRENCY = int(os.getenv("AGENT_MAX_CONCURRENCY", "8"))
MAX_TOOL_CALLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "8"))
SUBAGENT_TIMEOUT_S = float(os.getenv("AGENT_SUBAGENT_TIMEOUT_S", "240"))
RUN_TIMEOUT_S = float(os.getenv("AGENT_RUN_TIMEOUT_S", "480"))

LANGSMITH_PROJECT = os.getenv("LANGSMITH_PROJECT", "biohacks-als-research")


def tracing_enabled() -> bool:
    return os.getenv("LANGSMITH_TRACING", "").lower() == "true" and bool(os.getenv("LANGSMITH_API_KEY"))
