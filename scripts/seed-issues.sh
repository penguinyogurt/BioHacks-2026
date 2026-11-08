#!/usr/bin/env bash
# Run ONCE to move the task board from docs/STATUS.md into GitHub Issues.
#
#   gh auth login          # if you haven't
#   bash scripts/seed-issues.sh
#
# Safe to re-run: it skips any issue whose exact title already exists.
# Delete this file once the board is live — it has done its job.

set -euo pipefail
REPO="penguinyogurt/BioHacks-2026"

command -v gh >/dev/null || { echo "gh not installed: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "run: gh auth login"; exit 1; }

label() { gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null; }

echo "labels..."
label "track:discovery" 0E8A16 "FUS drug-repurposing pipeline"
label "track:pipeline"  1D76DB "Python BBB / patient filter / merge"
label "track:frontend"  5319E7 "Motus dashboard and shared UI"
label "track:facecheck" FBCA04 "MediaPipe facial amplitude"
label "track:speech"    D93F0B "Speech and diagnostic tests"
label "track:repo"      BFD4F2 "Tooling, docs, process"
label "decision"        B60205 "Needs a human call, not code"
label "blocker"         000000 "Something else waits on this"

existing=$(gh issue list --repo "$REPO" --state all --limit 200 --json title --jq '.[].title')

new() { # title, labels, body
  if grep -Fxq "$1" <<<"$existing"; then echo "  skip: $1"; return; fi
  gh issue create --repo "$REPO" --title "$1" --label "$2" --body "$3" >/dev/null
  echo "  made: $1"
}

echo "issues..."

new "Pick the product: discovery pipeline or Motus" "decision,blocker" \
"Both ship on \`main\`, in one sidebar, sharing nothing else.

A judge gets 90 seconds and can follow one argument. Everything else is
downstream of this call.

See \`docs/DISCOVERY_SPEC.md\` §4."

new "Pick the name: Addo Labs or motus" "decision,blocker" \
"\`frontend/src/lib/theme.ts\`, \`lib/pipeline.ts\` and \`discovery/report.tsx\` say
**Addo Labs**. The landing page says **motus**. A judge sees both in one scroll."

new "Jeremy and Levi are building the same five agents" "decision,blocker,track:discovery" \
"**Jeremy:** five-stage pipeline in \`frontend/\`, scripted TypeScript, \`MATCHES\`
hand-written, labelled Simulated.

**Levi:** \`backend/query-generation/\` on \`agentic-query-generation\` — five real
Python agents (disease-indications, genes-targets, pathways-processes,
safety-interactions-class, symptoms-function) plus rank intersection and a
fallback policy, grounded in DRKG.

Same five agents, twice. **No shared git history** — no merge base with \`main\`.

Cheapest win in the repo: make Jeremy's \`PipelineEvent\` stream come from Levi's
agents instead of a timer. His module header already says a live backend only
has to emit the same events. The trees never have to meet — JSON over the seam."

new "Stop saying 24 never-arrived drugs — it is 3" "track:discovery,blocker" \
"Measured against Neo's real \`pipeline.json\`:

24 \`never_arrived\` / 8 \`arrived_failed\`, but **21 of the 24 have no BBB
prediction at all** (biologics, or out of the model's domain). \`src/merge.py:211-214\`
files 'no prediction' as \`never_arrived\`.

Only ceftriaxone (0.39), pentoxifylline (0.29) and pioglitazone (0.29) are
actually predicted BBB-negative. Honest split: **3 / 8 / 21 undetermined.**

Same error in the funnel: '2,440 predicted BBB-negative' is 1,593 predicted +
847 out of domain.

**Use 1,593 of 3,791** — still the strong number, and it survives a question.
A judge who knows gabapentin crosses the BBB will catch the other one."

new "Wire real DRKG vectors into discovery stage 3" "track:discovery" \
"\`MATCHES\` in \`frontend/src/lib/pipeline.ts\` is hand-written. Neo's \`src/drkg.py\`
loads the real TransE vectors.

DRKG embeds *entities*, not text — a profile needs to become DRKG genes before
it has a vector. Jeremy's \`PROFILES\` already list target genes, so: map to
\`Gene::<Entrez>\`, average, cosine against compound vectors. Short bridge."

new "Port the Python pipeline onto a branch cut from main" "track:pipeline" \
"\`main\` has no pipeline code. \`cursor/pipeline-graph-ui\` has it, but also edits
\`app/\`, which main deleted — 11 conflicts, 9 of them that.

Clean approach, no conflicts:

\`\`\`bash
git checkout -b pipeline/python origin/main
git checkout origin/cursor/pipeline-graph-ui -- \\
  bbb_model.py patient_filter.py merge.py graveyard.py \\
  requirements.txt bbb/ src/ tests/ scripts/ server/
\`\`\`

Leave \`data/*.json\` and \`artifacts/\` behind — gitignored now, and that branch's
\`pipeline.json\` is 10.5 MB against main's 200 KB."

new "Write docs/SPEECH_SPEC.md" "track:speech" \
"The only track with no spec. Two branches of work nobody else can pick up or
pitch. Same shape as \`FACECHECK_SPEC.md\`: what it's for, what exists, what's
open, what's unverified."

new "Decide: FaceCheck as its own page, or a tab" "decision,track:facecheck" \
"\`docs/FACECHECK_SPEC.md\` §7. Also: two FaceChecks exist — Neo's TS original and
Levi's JS port. Pick one."

new "Three knowledge graphs exist — pick one" "decision,track:frontend" \
"Neo's \`GraphCanvas\`, Henri's stale \`KnowledgeGraph.tsx\`, and a 'coming soon'
placeholder on \`main\`."

new "Decide demo mode: signed-in or sample data" "decision,track:frontend" \
"Sample data works today with no keys and shows a Sample data badge. Sign-in
needs Supabase keys in \`frontend/.env\` (see \`.env.example\`)."

new "Motus: 15 dashboard views are still placeholders" "track:frontend" \
"Only Overview is built. The rest render 'coming soon' copy from \`VIEWS\` in
\`frontend/src/pages/Home.tsx\`. Fine for a demo that only opens Overview —
decide which, if any, matter before Sunday."

echo
echo "done. next:"
echo "  gh issue list --repo $REPO"
echo "  assign yourself what you're on, then delete this script."
