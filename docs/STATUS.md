# Status

**Who is on what, right now.** Read this at the start of every session;
update it at the end of every session, in the same commit as your work.

Keep it short. A stale entry is worse than a missing one — if you stopped
working on something, say so.

Last updated: **2026-11-07**

---

## In flight

| Person | Track | Branch | What they're on | Blocked on |
|---|---|---|---|---|
| Henri | repo / frontend | `main` | Repo cleanup: scrapped the dead frontends, extracted `contract/`, rewrote the process docs | — |
| Jeremy | frontend | `main` (merged) | **Discovery pipeline** — FUS-enabled repurposing, scripted end to end. See `DISCOVERY_SPEC.md`. Also the Motus dashboard: overview landed, 15 views still placeholders | Supabase keys; a live backend behind `runDemoPipeline` |
| Neo | pipeline | `cursor/pipeline-graph-ui` | Drug-repurposing pipeline — BBB + patient filter scored across 3,791 compounds | — |
| Neo | facecheck | `cursor/facial-als-validation` | FaceCheck MediaPipe prototype | See `FACECHECK_SPEC.md` §2 gaps |
| Levi | speech | `Master-UI-Neo-Face-Integration` | Speech + diagnostic test apps | Unrelated git history — merge is a decision, not a chore |

> Names are from git history. Correct them if they're wrong.

## Just landed

- **2026-11-07** — Repo cleanup on `main`: `app/` and `web/` (two dead
  drug-funnel frontends) deleted; the contract and validator extracted to
  `contract/` so the Python side keeps its check; `.gitignore` rewritten
  (`.env` was not ignored); `.workspace/` added for per-person AI config;
  CI repointed off the deleted `app/`.
- **2026-11-07** — `frontend/` (Motus) merged to `main` via PR #1.

## Open questions

These need a person, not an agent:

- **Is the product the discovery pipeline or Motus?** `main` ships both, in
  one sidebar, sharing nothing else. One demo, 90 seconds — a judge can
  follow one argument. **Decide this first; everything else depends on it.**
  (`DISCOVERY_SPEC.md` §4.)
- **What is it called?** The code says *Addo Labs*; the landing page says
  *motus*. Pick one.
- **Does the old elimination funnel feed the new pipeline?** The graveyard's
  `never_arrived` bucket is exactly the FUS-unlocked candidate pool — wire it
  in, or retire the contract and say so.
- **Does `Master-UI-Neo-Face-Integration` get merged into `main`?** It has an
  unrelated git history. Decide before Saturday evening or it stays separate.
- **Does FaceCheck ship as its own page or as a tab in Motus?**
  (`FACECHECK_SPEC.md` §7.)
- **Supabase**: who owns the project, and do we demo signed-in or on sample
  data? Sample data works today with no keys.
