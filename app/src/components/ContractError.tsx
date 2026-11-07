/**
 * Shown when data/pipeline.json doesn't satisfy the contract.
 *
 * This is a real screen, not a console warning, because the failure mode we're
 * guarding against is merge.py emitting a changed shape at 7am on demo day and
 * nobody noticing until a judge is standing at the table.
 */
export function ContractError({ problems }: { problems: string[] }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[42rem] flex-col justify-center px-6 py-16">
      <h1 className="text-2xl leading-tight">
        <code className="readout">data/pipeline.json</code> doesn&rsquo;t match the
        contract
      </h1>
      <p className="mt-2 text-md leading-normal text-ink-soft">
        The frontend refuses to render rather than show half a result. Fix the
        pipeline output, or update{" "}
        <code className="readout">app/src/lib/contract.ts</code> if the shape
        changed on purpose — then tell the team.
      </p>

      <ul className="mt-6 space-y-1.5 rounded-md border border-cut-rule bg-cut-soft p-4">
        {problems.map((problem) => (
          <li key={problem} className="readout text-sm leading-snug text-ink">
            {problem}
          </li>
        ))}
      </ul>

      <p className="mt-5 text-sm leading-normal text-ink-faint">
        Run <code className="readout">npm run check</code> in{" "}
        <code className="readout">app/</code> to see this from the terminal.
      </p>
    </main>
  );
}
