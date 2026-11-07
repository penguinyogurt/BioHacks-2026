/**
 * Guards the data contract. Run: `npm run check` (from app/).
 *
 * This exists for one reason: if merge.py changes the shape of
 * data/pipeline.json, this fails before anyone opens a browser. It also
 * asserts the rules the UI depends on, so a refactor can't silently drop
 * them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { parsePipeline, firstFailure, isSurvivor, passCount } from "./contract.ts";

const raw = JSON.parse(
  readFileSync(new URL("../../../data/pipeline.json", import.meta.url), "utf8"),
);

test("the committed sample satisfies the contract", () => {
  const result = parsePipeline(raw);
  assert.equal(
    result.ok,
    true,
    result.ok ? "" : `pipeline.json is invalid:\n  ${result.problems.join("\n  ")}`,
  );
});

test("the sample exercises every UI edge case the demo must survive", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);
  const { candidates } = result.data;

  assert.ok(
    candidates.some((c) => isSurvivor(c)),
    "need at least one survivor, or the graph has no shortlist nodes",
  );
  assert.ok(
    candidates.some((c) => !c.bbb.in_domain),
    "need an out-of-domain molecule, or the suppressed-probability state is never seen",
  );
  assert.ok(
    candidates.some((c) => c.eliminated_at === "patient_filter"),
    "need a patient_filter cut — that stage is the whole contribution",
  );
  assert.ok(
    candidates.some((c) => c.eliminated_at === "trial_history"),
    "need a trial_history cut",
  );
});

test("out-of-domain candidates carry no probability to render", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);
  for (const c of result.data.candidates) {
    if (!c.bbb.in_domain) {
      assert.equal(
        c.bbb.prob,
        null,
        `${c.name} is out of domain but still carries a probability; the UI must never show it`,
      );
    }
  }
});

test("eliminated candidates say where they died, survivors don't", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);
  for (const c of result.data.candidates) {
    if (c.verdict === "eliminated") {
      assert.notEqual(c.eliminated_at, null, `${c.name} eliminated but eliminated_at is null`);
    } else {
      assert.equal(c.eliminated_at, null, `${c.name} survived but has eliminated_at set`);
    }
  }
});

test("firstFailure picks the decisive rule, in order", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);

  for (const c of result.data.candidates) {
    const failure = firstFailure(c);
    if (failure === null) {
      assert.ok(
        c.filters.every((f) => f.passed),
        `${c.name}: firstFailure returned null but a rule failed`,
      );
    } else {
      const index = c.filters.indexOf(failure);
      assert.ok(
        c.filters.slice(0, index).every((f) => f.passed),
        `${c.name}: firstFailure skipped an earlier failure`,
      );
    }
  }
});

test("passCount counts what it says", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);
  for (const c of result.data.candidates) {
    const { passed, total } = passCount(c);
    assert.equal(total, c.filters.length);
    assert.ok(passed <= total);
    assert.equal(passed, c.filters.filter((f) => f.passed).length);
  }
});

test("the funnel only ever narrows", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);
  const { funnel } = result.data;
  for (let i = 1; i < funnel.length; i++) {
    assert.ok(
      funnel[i].count <= funnel[i - 1].count,
      `stage ${funnel[i].stage} (${funnel[i].count}) is larger than ${funnel[i - 1].stage} (${funnel[i - 1].count})`,
    );
  }
});

test("graveyard buckets agree with the reported partition counts", () => {
  const result = parsePipeline(raw);
  assert.ok(result.ok);
  const { graveyard, validation } = result.data;

  const counted = {
    never_arrived: graveyard.filter((g) => g.bucket === "never_arrived").length,
    arrived_failed: graveyard.filter((g) => g.bucket === "arrived_failed").length,
  };
  assert.deepEqual(
    counted,
    validation.partition,
    "validation.partition disagrees with the graveyard entries — the headline number would be wrong on the slide",
  );
});

test("a malformed payload is rejected with readable problems", () => {
  const result = parsePipeline({ meta: {}, funnel: [], candidates: [] });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.problems.length > 0);
  assert.ok(!result.ok && result.problems.every((p) => typeof p === "string"));
});
