"""Configuration shared by the imported Neo planner and research workers."""
import os
from pathlib import Path
from dotenv import dotenv_values
ROOT = Path(__file__).resolve().parents[1]
file_settings = dotenv_values(os.getenv("BH_AGENT_ENV_FILE",str(ROOT/"agent/.env")))
def setting(key, default=None):
    return os.environ.get(key) or file_settings.get(key) or default
ANTHROPIC_API_KEY = setting("ANTHROPIC_API_KEY") or setting("CLAUDE_API_KEY")
ORCHESTRATOR_MODEL = setting("CLAUDE_ORCHESTRATOR_MODEL","claude-sonnet-5-5")
SUBAGENT_MODEL = setting("CLAUDE_SUBAGENT_MODEL","claude-haiku-5-5")
MAX_TOOL_CALLS = int(setting("AGENT_MAX_TOOL_CALLS",8))
SUBAGENT_TIMEOUT_S = float(setting("AGENT_SUBAGENT_TIMEOUT_S",220))
CACHE_DIR = ROOT/"reports"/"public-tool-cache"
