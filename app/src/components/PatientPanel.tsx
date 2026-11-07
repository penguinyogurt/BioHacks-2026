import type { PatientProfile } from "@/lib/contract";

/**
 * The person before the ranked list.
 *
 * Stage 4 is the contribution, and it's only credible if a judge can see the
 * chart values it was derived from. Each finding names the rule ids it drives,
 * so the link from "FVC 61% supine" to `respiratory` is on screen rather than
 * in the pitch.
 */
export function PatientPanel({ profile }: { profile: PatientProfile }) {
  return (
    <section aria-labelledby="patient-heading" className="hairline-b pb-10">
      <header className="mb-5">
        <h2 id="patient-heading" className="text-[1.0625rem] leading-tight font-semibold">
          The constraints are {profile.display_name}&rsquo;s, not the disease&rsquo;s
        </h2>
        <p className="mt-1 max-w-[62ch] text-[0.8125rem] leading-normal text-ink-soft">
          {profile.summary}
        </p>
      </header>

      <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {profile.findings.map((finding) => (
          <li key={finding.label} className="hairline-t pt-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="label">{finding.label}</span>
              {finding.drives.length > 0 && (
                <span className="readout shrink-0 text-[0.6875rem] text-ink-faint">
                  {finding.drives.join(" ")}
                </span>
              )}
            </div>
            <p className="readout mt-1 text-[0.875rem] leading-snug font-medium">
              {finding.value.replace(/(\s)-(\d)/g, "$1−$2")}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-normal text-ink-soft">
              {finding.implication}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
