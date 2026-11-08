import { ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/page-header'

// Summary of Sunnybrook Research Institute's news release, 9 May 2025.
// The release reports the first procedure only. It gives no outcomes, safety
// data or journal citation, so this page doesn't claim any.
const SOURCE = 'https://research.sunnybrook.ca/2025/05/world-first-canadian-innovation-enhances-drug-access-to-brain-areas-affected-by-als/'

const FACTS: [string, string][] = [
  ['Site', 'Sunnybrook Health Sciences Centre, Toronto'],
  ['Phase', 'Phase 1, 6 participants'],
  ['Drug', 'Intravenous immunoglobulin (IVIg)'],
  ['Target', 'Motor cortex, both hemispheres'],
  ['Device', 'Next Generation Dome Helmet, MR-guided'],
  ['Announced', '9 May 2025'],
]

const STEPS = [
  { title: 'Infuse', body: 'The patient receives IVIg intravenously. On its own, very little of it crosses into the brain.' },
  { title: 'Open', body: 'MR-guided focused ultrasound from the Dome Helmet temporarily breaches the blood–brain barrier over the motor cortex on both sides.' },
  { title: 'Deliver', body: 'While the barrier is open, IVIg can reach the motor regions affected by ALS.' },
]

const GOALS = [
  { label: 'Primary', body: 'Safety and feasibility of opening the barrier to deliver more IVIg, using the Next Generation Dome Helmet.' },
  { label: 'Secondary', body: 'Changes in ALS biomarkers in the brain after the enhanced delivery.' },
]

const TIMELINE = [
  { year: '2016', body: 'Sunnybrook becomes the first Canadian Centre of Excellence in Focused Ultrasound.' },
  { year: '2019', body: 'MR-guided focused ultrasound opens the blood–brain barrier in four ALS patients, with no drug delivered.' },
  { year: '2025', body: 'The first of six patients receives IVIg through an opened barrier. Sunnybrook calls it a world first.' },
  { year: 'Next', body: 'An MRI-free device, with a helmet fitted to each patient’s head so they no longer need their head shaved or the helmet screwed in.' },
]

// Photos from the release, saved locally so the page works offline at the expo.
const PHOTOS = [
  { src: '/fus/fus-320edit-1024x683.webp', alt: 'The backs of three people observing a brain scan on a computer overlooking an MRI observation window.', caption: 'Watching the procedure from the MRI control room.' },
  { src: '/fus/fus-322-1350x900.webp', alt: 'A group of medical researchers stand in a group observing something on a computer', caption: 'Neurosurgeons, focused-ultrasound physicists, ALS clinician-researchers, imaging technicians and an anesthesiologist.' },
  { src: '/fus/fus-232-1350x900.webp', alt: 'The silhouettes of two researchers looking at a brain scan on a computer.', caption: 'Dallan McMahon and Ryan Jones support Dr. Nir Lipsman before the procedure.' },
  { src: '/fus/fus-277-1350x900.webp', alt: 'A group of 6 researchers stand outside an MRI room.', caption: 'Dr. Pedro Castro, Dr. Isabelle Aubert, Dr. Agessandro Abrahao, Jahan Mookshah, Dr. Lorne Zinman and Caroline Giuricich.' },
]

const PANEL = 'rounded-xl bg-card px-5 pt-5 pb-5 ring-1 ring-border backdrop-blur-md'

export default function FusPage() {
  return (
    <div className="mx-auto max-w-[1440px] text-sm">
      <PageHeader
        className="mb-3"
        eyebrow="Delivery & access / Focused ultrasound"
        title="Opening the barrier, on purpose."
        description="In May 2025, a Sunnybrook team gave IVIg, an immunotherapy that may calm ALS-related neuroinflammation, then used focused ultrasound to open the blood–brain barrier so the drug could reach the motor cortex. It is the first time a drug has been delivered this way in ALS."
      >
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
          {FACTS.map(([k, v]) => (
            <div key={k}>
              <dt className="eyebrow">{k}</dt>
              <dd className="mt-1.5">{v}</dd>
            </div>
          ))}
        </dl>
      </PageHeader>

      <div className="grid grid-cols-12 gap-3">
        <section className={`${PANEL} col-span-12 lg:col-span-8`}>
          <h3 className="text-lg">How it works</h3>
          <ol className="mt-4 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <p className="flex items-baseline gap-3 font-medium">
                  <span className="text-muted-foreground tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  {s.title}
                </p>
                <p className="mt-1.5 text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <Photo {...PHOTOS[0]} />

        <Photo {...PHOTOS[2]} />
        <section className={`${PANEL} col-span-12 lg:col-span-8`}>
          <h3 className="text-lg">What the trial measures</h3>
          <dl className="mt-4 space-y-4">
            {GOALS.map((g) => (
              <div key={g.label}>
                <dt className="eyebrow">{g.label}</dt>
                <dd className="mt-1.5">{g.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-muted-foreground">
            The release reports the first procedure only. It gives no results or safety data yet.
          </p>
        </section>

        <section className={`${PANEL} col-span-12 lg:col-span-8`}>
          <h3 className="text-lg">How we got here</h3>
          <ol className="mt-4 space-y-3 border-l border-border pl-5">
            {TIMELINE.map((t) => (
              <li key={t.year}>
                <p className="font-medium tabular-nums">{t.year}</p>
                <p className="mt-0.5 text-muted-foreground">{t.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <Photo {...PHOTOS[1]} />

        <Photo {...PHOTOS[3]} />
        <section className={`${PANEL} col-span-12 lg:col-span-8`}>
          <h3 className="text-lg">Why it matters here</h3>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Many of the candidates a discovery run surfaces are large molecules that barely cross the
            blood–brain barrier. Focused ultrasound is the route that could get them to the motor cortex.
            Removing the MRI step would also cut the cost and access barriers that keep this to a few
            specialist centres.
          </p>
          <figure className="mt-4 max-w-3xl border-l-2 border-border pl-5">
            <blockquote className="text-base">“For the first time in ALS, we were able to temporarily disrupt this barrier in order to allow the drug flow through.”</blockquote>
            <figcaption className="mt-1.5 text-muted-foreground">Dr. Agessandro Abrahao, co-lead investigator, Sunnybrook</figcaption>
          </figure>
          <div className="mt-5 border-t border-border pt-4 text-muted-foreground">
            <p>
              Co-led by Dr. Agessandro Abrahao and Dr. Lorne Zinman, directed by Dr. Nir Lipsman, with
              Dr. Kullervo Hynynen’s focused-ultrasound lab. Funded by the Focused Ultrasound Foundation,
              ALS Society of Canada, Brain Canada and the ALS Association. Photos: Sunnybrook Research Institute.
            </p>
            <a href={SOURCE} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-foreground underline underline-offset-4 hover:no-underline">
              Sunnybrook Research Institute, 9 May 2025
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </section>
      </div>
    </div>
  )
}

/** A photo panel that fills the height of the text panel beside it. */
function Photo({ src, alt, caption }: { src: string; alt: string; caption: string }) {
  return (
    <figure className={`${PANEL} col-span-12 flex flex-col lg:col-span-4`}>
      <div className="relative aspect-[3/2] overflow-hidden rounded-lg lg:aspect-auto lg:min-h-48 lg:flex-1">
        <img src={src} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
        <div className="pointer-events-none absolute inset-0 rounded-lg outline outline-1 -outline-offset-1 outline-black/10" aria-hidden />
      </div>
      <figcaption className="mt-2 text-xs text-pretty text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}
