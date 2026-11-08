"""Run one research pass in the terminal, no frontend needed.

  python -m agent.cli [--patient jordan] "Which drugs could help with cramps and sleep?"
"""
import asyncio
import json
import sys

from agent.config import MAX_CONCURRENCY, RUNS_DIR
from agent.graph import DEFAULT_QUESTION, graph


async def main(question: str, patient_id: str) -> None:
    import time

    run_id = time.strftime("cli%Y%m%d-%H%M%S")
    async for e in graph.astream({"run_id": run_id, "question": question, "patient_id": patient_id}, config={"max_concurrency": MAX_CONCURRENCY, "run_name": "research run (cli)"}, stream_mode="custom"):
        t, crit = e["type"], e.get("criterion", "")
        if t == "report":
            RUNS_DIR.mkdir(parents=True, exist_ok=True)
            out = RUNS_DIR / f"{run_id}.report.json"
            out.write_text(json.dumps(e["data"], indent=2), encoding="utf-8")
            print(f"\n=== {len(e['data']['profiles'])} target profiles -> {out}\n{e['data']['summary']}")
            for p in e["data"]["profiles"]:
                targets = ", ".join(f"{t['symbol']}:{t['desired_action']}" for t in p["molecular_targets"])
                print(f"  {p['rank']:>2}. [{p['criterion']}] {p['therapeutic_goal'][:90]}  ({targets})")
        else:
            print(f"[{t}] {crit} {json.dumps(e.get('data'))[:200]}")


if __name__ == "__main__":
    args = sys.argv[1:]
    pid = "alex"
    if args[:1] == ["--patient"]:
        pid, args = args[1], args[2:]
    asyncio.run(main(" ".join(args) or DEFAULT_QUESTION, pid))
