import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { AlertTriangle, ArrowLeft, ChevronRight, Eye, Minus, Plus, TrendingDown, TrendingUp } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PageHeader } from '@/components/page-header'
import { useGo } from '@/components/discovery/pieces'
import { useRun } from '@/lib/run-store'
import { cn } from '@/lib/utils'
import { ALSFRS, ALSFRS_DOMAINS, ALSFRS_SLOPE, FLAGS, FVC, HAND, PATIENT, SPEECH, TESTS, WEIGHT } from '@/lib/alex-case'

/**
 * Patient monitoring, laid out after the shadcn dashboard: pick a patient,
 * then four stat cards, one switchable trend chart, and a single table.
 * Every number is stated in the case file (see lib/alex-case.ts).
 */

/**
 * Patients with monitoring data. Only Alex's file has longitudinal measurements so far,
 * transcribed in lib/alex-case.ts, and they're shown only once that file has been uploaded.
 */
const PATIENTS = [
  {
    id: 'alex-chen',
    name: PATIENT.name,
    line: `${PATIENT.age}${PATIENT.sex} · limb-onset ALS`,
    lastVisit: '22 Sep 2026',
    alsfrs: ALSFRS[ALSFRS.length - 1].score,
    fvc: FVC[FVC.length - 1].sitting,
    flags: FLAGS.filter((f) => f.level === 'flag').length,
  },
]

const initials = (name: string) => name.split(' ').map((w) => w[0]).join('').slice(0, 2)
/** Months since first symptom (June 2024) as a short date. */
const monthLabel = (m: number) =>
  new Intl.DateTimeFormat('en-CA', { month: 'short', year: 'numeric' }).format(new Date(2024, 5 + m, 1))

/** The patients whose case file has been uploaded this session (Patient case page). Empty until then. */
function useUploadedPatients() {
  const { caseFile } = useRun()
  const uploaded = caseFile?.patient.label.trim().toLowerCase()
  return { patients: uploaded ? PATIENTS.filter((p) => p.name.toLowerCase() === uploaded) : [], uploadedName: caseFile?.patient.label ?? null }
}

export default function OverviewDashboard() {
  const [params, setParams] = useSearchParams()
  const { patients, uploadedName } = useUploadedPatients()
  const patient = patients.find((p) => p.id === params.get('p'))
  // The selection lives in the URL, so browser back returns to the list.
  return patient ? (
    <PatientView onBack={() => setParams({})} />
  ) : (
    <PatientPicker patients={patients} uploadedName={uploadedName} onPick={(id) => setParams({ p: id })} />
  )
}

/* ------------------------------------------------------------- picker */

function PatientPicker({ patients, uploadedName, onPick }: { patients: typeof PATIENTS; uploadedName: string | null; onPick: (id: string) => void }) {
  const go = useGo()
  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <PageHeader
        eyebrow="Library / Patient monitoring"
        title="Patients"
        description={patients.length ? 'Choose a patient to see how their measurements are changing.' : 'No patients yet. Upload a case PDF to start monitoring.'}
      />
      {uploadedName && !patients.length ? (
        <p className="text-muted-foreground">{uploadedName}’s case file has no longitudinal measurements to monitor.</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {patients.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className="group rounded-xl text-left transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            <Card className="h-full gap-5 transition-shadow duration-200 group-hover:ring-foreground/25 [--card-spacing:--spacing(5)]">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="text-sm">{initials(p.name)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <CardDescription>{p.line}</CardDescription>
                  </div>
                </div>
                <CardAction>
                  <ChevronRight className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden />
                </CardAction>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3 tabular-nums">
                <Stat label="ALSFRS-R" value={`${p.alsfrs}/48`} />
                <Stat label="FVC" value={`${p.fvc}%`} />
                <Stat label="Last visit" value={p.lastVisit} />
              </CardContent>
              <CardFooter className="border-t-0 bg-transparent pt-0">
                <Badge variant="outline" className="gap-1 border-flag/40 bg-flag/10 font-normal text-flag">
                  <AlertTriangle className="size-3" aria-hidden /> {p.flags} flags
                </Badge>
              </CardFooter>
            </Card>
          </button>
        ))}
        <button
          type="button"
          onClick={() => go('case')}
          className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-foreground/15 bg-card/60 text-muted-foreground backdrop-blur-md transition-colors duration-150 hover:border-foreground/30 hover:text-foreground"
        >
          <Plus className="size-5" aria-hidden />
          <span className="font-medium">Add a patient</span>
          <span className="text-xs">Upload their case PDF</span>
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  )
}

/* -------------------------------------------------------- patient view */

const SERIES = {
  alsfrs: {
    label: 'ALSFRS-R',
    description: 'Functional rating out of 48, every clinic score since first symptom',
    data: ALSFRS.map((p) => ({ m: p.m, a: p.score })),
    domain: [24, 48] as [number, number],
    config: { a: { label: 'ALSFRS-R', color: 'var(--chart-3)' } } satisfies ChartConfig,
  },
  fvc: {
    label: 'Vital capacity',
    description: 'FVC, % predicted. Reference: above 80 sitting',
    data: FVC.map((p) => ({ m: p.m, a: p.sitting, b: p.supine })),
    domain: [40, 100] as [number, number],
    config: { a: { label: 'Sitting', color: 'var(--chart-3)' }, b: { label: 'Lying flat', color: 'var(--chart-1)' } } satisfies ChartConfig,
  },
  weight: {
    label: 'Weight',
    description: 'Kilograms, measured visits only',
    data: WEIGHT.map((p) => ({ m: p.m, a: p.kg })),
    domain: [70, 90] as [number, number],
    config: { a: { label: 'Weight (kg)', color: 'var(--chart-4)' } } satisfies ChartConfig,
  },
}
type SeriesKey = keyof typeof SERIES

/** Measurements and tests in one table; "abnormal" is stated, never inferred from colour alone. */
const MEASUREMENTS = [
  { test: 'Speaking rate, 9 am / 4 pm', value: `${SPEECH.rate.am} / ${SPEECH.rate.pm} words/min`, reference: `${SPEECH.rate.typical[0]}–${SPEECH.rate.typical[1]}`, abnormal: true, source: 'Speech-language, 22 Sep 2026' },
  { test: 'Intelligibility, 9 am / 4 pm', value: `${SPEECH.intelligibility.am} / ${SPEECH.intelligibility.pm}%`, reference: `Above ${SPEECH.intelligibility.typical}%`, abnormal: true, source: 'Speech-language, 22 Sep 2026' },
  ...HAND.map((h) => ({ test: `${h.measure}, right / left`, value: `${h.right} / ${h.left} ${h.unit}`, reference: `About ${h.typical} ${h.unit}`, abnormal: true, source: 'ALS clinic, 22 Sep 2026' })),
  ...TESTS,
]

function PatientView({ onBack }: { onBack: () => void }) {
  const [series, setSeries] = useState<SeriesKey>('alsfrs')
  const s = SERIES[series]
  const alsfrs = ALSFRS[ALSFRS.length - 1]
  const fvc = FVC[FVC.length - 1]
  const weight = WEIGHT[WEIGHT.length - 1]

  return (
    <div className="mx-auto max-w-[1440px] space-y-3 text-sm">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
        <ArrowLeft aria-hidden /> All patients
      </Button>
      <PageHeader
        eyebrow="Library / Patient monitoring"
        title={PATIENT.name}
        description={`${PATIENT.age}${PATIENT.sex} · ${PATIENT.summary} · diagnosed ${PATIENT.diagnosed}`}
      >
        <p className="mt-1 text-xs text-muted-foreground">{PATIENT.medication} · {PATIENT.genetics}</p>
      </PageHeader>

      {/* Section cards, as in the shadcn dashboard: label, value, trend badge, two-line footer. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="ALSFRS-R" value={`${alsfrs.score}`} unit="/ 48" trend={`${ALSFRS_SLOPE}/mo`} headline={`Down ${ALSFRS[0].score - alsfrs.score} points since onset`} note="Roughly linear, clinic score Sep 2026" />
        <StatCard label="Vital capacity, sitting" value={`${fvc.sitting}%`} trend={`${fvc.sitting - FVC[0].sitting} since Jun`} headline={`${fvc.supine}% lying flat`} note="Reference above 80% · diaphragm weakness" />
        <StatCard label="Weight" value={`${weight.kg}`} unit="kg" trend={`${(weight.kg - WEIGHT[0].kg).toFixed(1)} kg`} headline="Down 10% in two years" note="Calorie supplement started" />
        <StatCard label="Neurofilament light" value="88" unit="pg/mL" trend="5.9× ref" up headline="Marker of active nerve damage" note="Reference below 15 at age 47" />
      </div>

      <Card className="[--card-spacing:--spacing(5)]">
        <CardHeader>
          <CardTitle className="text-base">{s.label}</CardTitle>
          <CardDescription>{s.description}</CardDescription>
          <CardAction>
            <ToggleGroup type="single" variant="outline" size="sm" value={series} onValueChange={(v) => v && setSeries(v as SeriesKey)}>
              {(Object.keys(SERIES) as SeriesKey[]).map((k) => (
                <ToggleGroupItem key={k} value={k} className="px-3">{SERIES[k].label}</ToggleGroupItem>
              ))}
            </ToggleGroup>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ChartContainer config={s.config} className="aspect-auto h-64 w-full">
            <AreaChart data={s.data} margin={{ left: 0, right: 12, top: 8, bottom: 0 }}>
              <defs>
                {Object.keys(s.config).map((k) => (
                  <linearGradient key={k} id={`fill-${k}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${k})`} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={`var(--color-${k})`} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="m" type="number" domain={['dataMin', 'dataMax']} padding={{ left: 16, right: 16 }} ticks={s.data.map((d) => d.m)} tickFormatter={monthLabel} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis domain={s.domain} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" labelFormatter={(_l, p) => monthLabel(p?.[0]?.payload?.m ?? 0)} />} />
              {Object.keys(s.config).map((k) => (
                <Area key={k} dataKey={k} type="linear" fill={`url(#fill-${k})`} stroke={`var(--color-${k})`} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="[--card-spacing:--spacing(5)]">
          <CardHeader>
            <CardTitle className="text-base">ALSFRS-R by domain</CardTitle>
            <CardDescription>Each out of 12 · Sep 2026</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 tabular-nums">
            {ALSFRS_DOMAINS.map((d) => (
              <div key={d.domain} className="space-y-1.5">
                <div className="flex justify-between">
                  <span>{d.domain}</span>
                  <span className="text-muted-foreground">{d.score} / 12</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-chart-3" style={{ width: `${(d.score / 12) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="[--card-spacing:--spacing(5)]">
          <CardHeader>
            <CardTitle className="text-base">What to watch</CardTitle>
            <CardDescription>Concerns the case file raises</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {FLAGS.map((f) => {
              const Icon = f.level === 'flag' ? AlertTriangle : Eye
              return (
                <div key={f.title} className="flex gap-3">
                  <Icon className={cn('mt-0.5 size-4 shrink-0', f.level === 'flag' ? 'text-flag' : 'text-watch')} aria-hidden />
                  <div>
                    <p className="font-medium">
                      {f.title} <span className="sr-only">({f.level === 'flag' ? 'flag' : 'watch'})</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{f.detail}</p>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 py-0 [--card-spacing:--spacing(5)]">
        <CardHeader className="py-5">
          <CardTitle className="text-base">Measurements and tests</CardTitle>
          <CardDescription>Latest value of each, against its reference range</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-5">Measure</TableHead>
              <TableHead>Result</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-5">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="tabular-nums">
            {MEASUREMENTS.map((t) => (
              <TableRow key={t.test}>
                <TableCell className="pl-5 font-medium">{t.test}</TableCell>
                <TableCell>{t.value}</TableCell>
                <TableCell className="text-muted-foreground">{t.reference}</TableCell>
                <TableCell>
                  {t.abnormal ? (
                    <Badge variant="outline" className="gap-1 border-flag/40 font-normal text-flag"><AlertTriangle className="size-3" aria-hidden /> Outside range</Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground"><Minus className="size-3" aria-hidden /> No range</Badge>
                  )}
                </TableCell>
                <TableCell className="pr-5 text-muted-foreground">{t.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}

function StatCard({ label, value, unit, trend, up = false, headline, note }: { label: string; value: string; unit?: string; trend: string; up?: boolean; headline: string; note: string }) {
  return (
    <Card className="@container/card [--card-spacing:--spacing(5)]">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">
          {value}
          {unit ? <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span> : null}
        </CardTitle>
        <CardAction>
          <Badge variant="outline" className="gap-1 font-normal tabular-nums">
            {up ? <TrendingUp className="size-3" aria-hidden /> : <TrendingDown className="size-3" aria-hidden />} {trend}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 border-t-0 bg-transparent pt-0 text-sm">
        <p className="font-medium">{headline}</p>
        <p className="text-muted-foreground">{note}</p>
      </CardFooter>
    </Card>
  )
}
