# Status — the shared task board

**This is the one place work is claimed.** Read it at the start of every
session. Claim before you write code. Release when you stop.

There is no task framework to install — `gh` isn't on these machines and
four people on three different AI harnesses have exactly one medium in
common, which is this repo. So the board is a file, and the protocol below
is what makes it work.

Last updated: **2026-11-07**

---

## How to claim (all of it)

1. **`git pull`** — then put your name on the line you want, in **In flight**.
2. **Commit just this file and push immediately.** Don't bundle the claim
   with your work; the claim is worthless if it lands an hour later.
   ```bash
   git pull && git add docs/STATUS.md && git commit -m "claim: <task>" && git push
   ```
3. **If the push is rejected**, someone claimed something while you typed.
   `git pull --rebase`, check your task is still free, push again.
4. **When you stop** — done, blocked, or bored — move the line to **Done** or
   back to **Open**, with one line on where you left it. A task parked
   silently is the same as a task nobody did.

If two of you end up on the same line anyway, that's a conflict in one
markdown row. Keep both names, talk, move on.

**Your task isn't on the board?** Most won't be. Add the line and claim it
in the same push — that *is* the claim. Don't go looking for permission.

**When not to claim.** Claiming costs a push, so it has to buy something.
Skip it for anything another person could not plausibly start at the same
time: reading code, answering a question, a typo, a one-line fix, anything
under ~10 minutes. Claim when you're about to **create a file, change a
shared one, or work somewhere for a while** — that's when collisions happen.
A board full of "fixed a typo" is a board nobody reads.

---

## In flight — claimed, don't touch

| Who | Track | Branch | Task | Blocked on |
|---|---|---|---|---|
| Jeremy | discovery | `main` | FUS discovery pipeline — scripted end to end. See `DISCOVERY_SPEC.md` | A live backend behind `runDemoPipeline` |
| Jeremy | frontend | `main` | Motus dashboard — overview landed, 15 views still placeholders | Supabase keys |
| Neo | pipeline | `cursor/pipeline-graph-ui` | Drug pipeline — BBB + patient filter scored over 3,791 compounds | — |
| Neo | facecheck | `cursor/facial-als-validation` | FaceCheck MediaPipe prototype | `FACECHECK_SPEC.md` §2 gaps |
| Levi | speech | `Master-UI-Neo-Face-Integration` | Speech + diagnostic test apps | No spec in `docs/` yet |
| Henri | repo | `main` | Cleanup, specs, this board | — |

> Names are from git history. Fix them if they're wrong.

## Open — unclaimed, grab one

Ordered roughly by what hurts most if it's still open on Sunday morning.

| Track | Task | Why it matters |
|---|---|---|
| **decision** | **Pick the product: discovery pipeline or Motus.** Both ship on `main`, in one sidebar, sharing nothing else | 90 seconds, one argument. Everything below depends on this |
| **decision** | **Pick the name.** Code says *Addo Labs*, landing page says *motus* | A judge sees both in one scroll |
| discovery | Wire the graveyard's `never_arrived` bucket in as the FUS candidate pool | It already exists in `data/pipeline.json` and is exactly the right set — `DISCOVERY_SPEC.md` §1 |
| discovery | Real citations for the Sunnybrook MRgFUS claim; be precise about human vs proposed | The whole pitch rests on it, and someone will ask |
| pipeline | Port the Python onto a branch cut from `main` (leave `data/*.json` and `artifacts/` behind) | `main` has no pipeline code today |
| speech | Write `docs/SPEECH_SPEC.md` | The only track with no spec — nobody else can pick it up |
| frontend | Decide demo mode: signed-in or sample data | Sample works today with no keys |
| facecheck | Decide: own page, or a tab in the app | `FACECHECK_SPEC.md` §7 |
| discovery | A real backend behind `runDemoPipeline` — stretch | The seam is clean; don't collapse it under time pressure |

## Found while auditing — read before you pitch

Measured against Neo's real `pipeline.json` on `cursor/pipeline-graph-ui`,
not the sample. Full citations in [`FUS_RESEARCH.md`](FUS_RESEARCH.md).

1. **The graveyard overstates `never_arrived`.** 24 `never_arrived` / 8
   `arrived_failed` — but **21 of the 24 have no BBB prediction at all**
   (biologics, or out of the model's domain). `src/merge.py:211-214` files
   "no prediction" as `never_arrived`. Only ceftriaxone (p 0.39),
   pentoxifylline (0.29) and pioglitazone (0.29) are actually predicted
   BBB-negative. Honest split: **3 / 8 / 21 undetermined.** Say "3 predicted
   never-arrived, 21 we can't call" on stage, never "24" — a judge who knows
   gabapentin crosses the BBB will catch it.
2. **Same error in the funnel.** "2,440 eliminated: predicted BBB-negative"
   is **1,593 predicted negative + 847 out of domain.** The honest number is
   still the strong one: **1,593 approved drugs the model says can't cross.**
   That is the FUS-unlocked pool — use it.
3. **Discovery stage 3 is fake while a real one exists.** `MATCHES` in
   `frontend/src/lib/pipeline.ts` is hand-written; Neo's `src/drkg.py` loads
   the real DRKG TransE vectors. Note DRKG embeds *entities*, not text, so a
   profile has to become DRKG genes before it has a vector — Jeremy's
   profiles already list target genes, so that bridge is short.
4. **Three knowledge graphs and two FaceChecks exist.** Graph: Neo's
   `GraphCanvas`, Henri's stale `KnowledgeGraph.tsx`, and a "coming soon"
   placeholder on `main`. FaceCheck: Neo's TS original and Levi's JS port.
   Pick one of each.

## Done

- **2026-11-07** · Henri · Repo cleanup: `app/` and `web/` deleted, contract
  extracted to `contract/`, `.gitignore` rewritten (`.env` was exposed),
  `.workspace/` added, CI deleted — run `npm test --prefix contract` yourself.
- **2026-11-07** · Henri · `DISCOVERY_SPEC.md` written from Jeremy's pitch.
- **2026-11-07** · Jeremy · Discovery pipeline UI + Motus dashboard merged
  (PRs #1, #2).

---

## If main gives you a `tsconfig.tsbuildinfo` conflict — read this first

**Jeremy, this is the one you're hitting.** `frontend/tsconfig.tsbuildinfo`
is TypeScript's incremental build cache. It was committed by mistake, it
rewrites itself on every single build, so it conflicted constantly. `main`
untracked it on 2026-11-07 and it's gitignored now.

Your branch has it modified, main deleted it → modify/delete conflict.
Accept the deletion; it regenerates on your next build and will never come
back:

```bash
git rm --cached frontend/tsconfig.tsbuildinfo
git commit --no-edit
```

One time only. Sorry — that one's on Henri, and it was the only file under
`frontend/` that main touched.

## Heads-up if you merge main

`main` deleted `app/` on 2026-11-07, so branches that built there get
modify/delete conflicts (measured: 11 on `cursor/pipeline-graph-ui`, 19 on
`frontend/kg-and-provenance`). `Master-UI-Neo-Face-Integration` and
`codex/diagnostic-tests` share **no common ancestor** with main and can't be
merged without `--allow-unrelated-histories`. Your branch, your call.
