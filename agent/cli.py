"""Run one research pass in the terminal, no frontend needed.

  python -m agent.cli "Which drugs could help with cramps and sleep?"
"""
import asyncio
import json
import sys

from agent.config import MAX_CONCURRENCY, RUNS_DIR
from agent.graph import DEFAULT_QUESTION, graph


async def main(question: str) -> None:
    import time

    run_id = time.strftime("cli%Y%m%d-%H%M%S")
    async for e in graph.astream({"run_id": run_id, "question": question}, config={"max_concurrency": MAX_CONCURRENCY, "run_name": "research run (cli)"}, stream_mode="custom"):
        t, crit = e["type"], e.get("criterion", "")
        if t == "report":
            RUNS_DIR.mkdir(parents=True, exist_ok=True)
            out = RUNS_DIR / f"{run_id}.report.json"
            out.write_text(json.dumps(e["data"], indent=2), encoding="utf-8")
            print(f"\n=== {len(e['data']['findings'])} findings → {out}\n{e['data']['summary']}")
            for f in e["data"]["findings"]:
                print(f"  {f['rank']:>2}. {f['drug']:<28} {f['criterion']:<4} {f['evidence_level']:<16} safety={f['safety']}")
        else:
            print(f"[{t}] {crit} {json.dumps(e.get('data'))[:200]}")


if __name__ == "__main__":
    asyncio.run(main(" ".join(sys.argv[1:]) or DEFAULT_QUESTION))
