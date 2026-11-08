import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, Scatter, XAxis, YAxis } from 'recharts'
import { AudioLines, Bell, CalendarClock, ChevronDown, Keyboard, PenLine, Share2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardAction, CardFooter } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  CLINIC_VISITS, DAY, IS_SAMPLE, NEXT_VISIT, SESSIONS, STATUS_LABEL,
  fmtDate, summarize, type Modality, type Status,
} from '@/lib/sample-data'

const RANGES = [30, 90, 180] as const
const ICONS: Record<Modality, typeof Keyboard> = { speech: AudioLines, typing: Keyboard, handwriting: PenLine }
const STATUS_CLASS: Record<Status, string> = {
  flag: 'border-flag/40 bg-flag/10 text-flag',
  watch: 'border-watch/40 bg-watch/10 text-watch',
  stable: 'border-border bg-foreground/5 text-stable',
}

const fmt = (v: number, d: number) => v.toFixed(d)
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`

function StatusBadge({ status }: { status: Status }) {
  return <Badge variant="outline" className={cn('font-normal', STATUS_CLASS[status])}>{STATUS_LABEL[status]}</Badge>
}

/** calhacks' mini Trend: one hairline, no axes. */
function Spark({ values, className }: { values: number[]; className?: string }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 120},${28 - ((v - min) / (max - min || 1)) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 120 30" preserveAspectRatio="none" className={cn('h-7 w-[35%] shrink-0 text-chart-3', className)} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function Metric({ label, value, unit, detail, values }: { label: string; value: string; unit?: string; detail: string; values: number[] }) {
  return (
    <Card className="col-span-12 gap-3 [--card-spacing:--spacing(5)] sm:col-span-6 xl:col-span-3">
      <CardContent className="flex flex-col gap-3">
        <h2 className="text-[0.9375rem] font-normal text-muted-foreground">{label}</h2>
        <p className="font-heading text-[clamp(1.875rem,2.6vw,2.6rem)] leading-tight font-normal tracking-tight tabular-nums">
          {value}
          {unit ? <span className="ml-1.5 text-sm text-muted-foreground">{unit}</span> : null}
        </p>
        <div className="flex items-end justify-between gap-2">
          <span className="text-xs text-muted-foreground">{detail}</span>
          <Spark values={values} />
        </div>
      </CardContent>
    </Card>
  )
}

const projectionConfig = {
  alsfrs: { label: 'Estimated (model)', color: 'var(--chart-3)' },
  forecast: { label: 'Forecast', color: 'var(--chart-3)' },
  band: { label: '80% interval', color: 'var(--chart-2)' },
  clinician: { label: 'Clinician-rated', color: 'var(--foreground)' },
} satisfies ChartConfig

const domainConfig = {
  speech: { label: 'Speech · bulbar', color: 'var(--chart-4)' },
  typing: { label: 'Typing · fine motor', color: 'var(--chart-2)' },
  handwriting: { label: 'Handwriting · fine motor', color: 'var(--chart-1)' },
} satisfies ChartConfig

const tooltipDate = (_: unknown, payload: readonly { payload?: { t?: number } }[]) =>
  payload?.[0]?.payload?.t ? fmtDate(payload[0].payload.t) : ''

export default function OverviewDashboard({ title }: { title: string }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(90)
  const data = useMemo(() => summarize(range), [range])
  const { period, first, latest, modalities } = data

  const projection = useMemo(() => {
    const start = latest.t - range * DAY
    const rows: Record<string, number | [number, number] | undefined>[] = period.map((s) => ({ t: s.t, alsfrs: s.alsfrs }))
    for (const v of CLINIC_VISITS) {
      const t = SESSIONS[0].t + v.day * DAY
      if (t >= start) rows.push({ t, clinician: v.score })
    }
    for (const f of data.forecast) rows.push({ t: f.t, forecast: f.forecast, band: f.band })
    return rows.sort((a, b) => (a.t as number) - (b.t as number))
  }, [period, latest, range, data.forecast])

  const trends = period.map((s) => ({ t: s.t, ...s.z }))
  const mostChanged = modalities
    .flatMap((m) => m.features)
    .filter((f) => f.worse)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 4)
  const alerts = [
    ...modalities
      .filter((m) => m.status !== 'stable')
      .map((m) => {
        const worst = [...m.features].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
        return {
          status: m.status,
          title: `${m.label}: ${worst.label.toLowerCase()} ${signed(worst.change * 100, 0)}% vs baseline`,
          detail: `${m.domain} composite ${signed(m.z)}σ · below −1σ for ${m.daysBelow} sessions`,
        }
      }),
    ...(data.adherence < 0.8
      ? [{ status: 'watch' as Status, title: 'Fewer sessions than planned', detail: `${Math.round(data.adherence * 100)}% of days in this period` }]
      : []),
  ]

  return (
    <div className="mx-auto max-w-[1440px] text-sm tabular-nums">
      <div className="mb-3 rounded-xl bg-card px-5 pt-5 pb-3 ring-1 ring-border backdrop-blur-md">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Patient / Motor-function monitoring</p>
          <h2 className="font-brand mt-3 text-[clamp(2.5rem,4vw,3.75rem)] leading-none">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {IS_SAMPLE ? (
            <Badge variant="outline" className="border-watch/40 bg-watch/10 font-normal text-watch">Sample data</Badge>
          ) : null}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={String(range)}
            onValueChange={(v) => v && setRange(Number(v) as (typeof RANGES)[number])}
            aria-label="Dashboard time range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r} value={String(r)} className="px-3 text-xs data-[state=on]:bg-foreground data-[state=on]:text-background">
                {r}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </header>

      <div className="flex flex-wrap justify-between gap-3 text-[0.6875rem] text-muted-foreground">
        <span>{fmtDate(first.t)} — {fmtDate(latest.t)}</span>
        <span>{period.length} at-home sessions · baseline = first 28 days</span>
      </div>
      </div>

      <div className="grid grid-cols-12 gap-3" aria-live="polite">
        <Metric
          label="Motor function index"
          value={fmt(latest.mfi, 1)}
          detail={`${signed(data.mfiChange)} this period · baseline 100`}
          values={period.map((s) => s.mfi)}
        />
        <Metric
          label="Estimated ALSFRS-R"
          value={fmt(latest.alsfrs, 1)}
          unit="/ 48"
          detail={`Last clinic score ${CLINIC_VISITS[CLINIC_VISITS.length - 1].score}`}
          values={period.map((s) => s.alsfrs)}
        />
        <Metric
          label="Progression rate"
          value={signed(data.alsfrsSlope, 2)}
          unit="pts / mo"
          detail="ΔALSFRS-R, last 60 days"
          values={period.map((s) => s.alsfrs)}
        />
        <Metric
          label="Adherence"
          value={`${Math.round(data.adherence * 100)}%`}
          detail={`${period.length} of ${range} days`}
          values={period.map((_, i) => i)}
        />

        <Card className="col-span-12 [--card-spacing:--spacing(5)] xl:col-span-8">
          <CardHeader>
            <CardTitle className="text-lg font-normal">ALSFRS-R projection</CardTitle>
            <CardAction className="text-[0.625rem] text-muted-foreground">6-month forecast</CardAction>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-baseline gap-3">
              <strong className="font-heading text-4xl font-normal tracking-tight">{fmt(data.forecast[6].forecast, 1)}</strong>
              <span className="text-xs text-muted-foreground">
                projected by {fmtDate(data.forecast[6].t)} · {fmt(data.forecast[6].band[0], 1)}–{fmt(data.forecast[6].band[1], 1)}
              </span>
            </div>
            <ChartContainer config={projectionConfig} className="aspect-auto h-[17.5rem] w-full">
              <ComposedChart data={projection} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 6" />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtDate} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis domain={[38, 48]} tickLine={false} axisLine={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={tooltipDate} />} />
                <Area dataKey="band" stroke="none" fill="var(--color-band)" fillOpacity={0.12} connectNulls isAnimationActive={false} />
                <Line dataKey="alsfrs" stroke="var(--color-alsfrs)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                <Line dataKey="forecast" stroke="var(--color-forecast)" strokeWidth={2} strokeDasharray="5 5" dot={false} connectNulls isAnimationActive={false} />
                <Scatter dataKey="clinician" fill="var(--color-clinician)" isAnimationActive={false} />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
          <CardFooter className="flex-wrap gap-4 border-t text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-chart-3" /> Estimated from at-home sessions</span>
            <span className="inline-flex items-center gap-1.5"><i className="size-1.5 rounded-full bg-foreground" /> Clinician-rated</span>
            <span className="ml-auto">Model output · not a diagnosis</span>
          </CardFooter>
        </Card>

        <Card className="col-span-12 [--card-spacing:--spacing(5)] md:col-span-6 xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-lg font-normal">Early-detection signal</CardTitle>
            <CardAction className="text-[0.625rem] text-muted-foreground">vs your baseline</CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {modalities.map((m) => {
              const Icon = ICONS[m.key]
              // meter: −4σ … +1σ, filled from 0 toward the value
              const pct = (v: number) => ((Math.max(-4, Math.min(1, v)) + 4) / 5) * 100
              return (
                <div key={m.key} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2">
                      <Icon className="size-4 text-muted-foreground" aria-hidden />
                      {m.label}
                      <span className="text-xs text-muted-foreground">{m.domain}</span>
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <strong className="font-normal">{signed(m.z)}σ</strong>
                      <StatusBadge status={m.status} />
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-muted" role="img" aria-label={`${m.label} ${signed(m.z)} standard deviations from baseline`}>
                    <span
                      className={cn('absolute inset-y-0 rounded-full', m.status === 'flag' ? 'bg-flag' : m.status === 'watch' ? 'bg-watch' : 'bg-stable')}
                      style={{ left: `${Math.min(pct(m.z), pct(0))}%`, width: `${Math.abs(pct(m.z) - pct(0))}%` }}
                    />
                    {[-2, -1, 0].map((g) => (
                      <span key={g} className="absolute -inset-y-0.5 w-px bg-foreground/30" style={{ left: `${pct(g)}%` }} />
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="mt-1 border-t pt-4">
              <p className="mb-2 text-xs text-muted-foreground">Most-changed features</p>
              {mostChanged.map((f, i) => (
                <div key={f.key} className="flex items-center justify-between gap-2 py-1.5">
                  <span>
                    <small className="mr-2.5 text-[0.625rem] text-muted-foreground">{String(i + 1).padStart(2, '0')}</small>
                    {f.label}
                  </span>
                  <span className={f.worse ? 'text-flag' : 'text-muted-foreground'}>{signed(f.change * 100, 0)}%</span>
                </div>
              ))}
            </div>
          </CardContent>
          <CardFooter className="border-t text-[0.6875rem] text-muted-foreground">
            7-session mean · watch ≤ −1σ · flag ≤ −2σ
          </CardFooter>
        </Card>

        <Card className="col-span-12 [--card-spacing:--spacing(5)] xl:col-span-8">
          <CardHeader>
            <CardTitle className="text-lg font-normal">Change from baseline by domain</CardTitle>
            <CardAction className="text-[0.625rem] text-muted-foreground">z-score, 7-session mean</CardAction>
          </CardHeader>
          <CardContent>
            <ChartContainer config={domainConfig} className="aspect-auto h-72 w-full">
              <LineChart data={trends} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 6" />
                <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtDate} tickLine={false} axisLine={false} minTickGap={40} />
                <YAxis domain={[-6, 2]} ticks={[-6, -4, -2, 0, 2]} tickLine={false} axisLine={false} width={28} />
                <ReferenceLine y={-1} stroke="var(--status-watch)" strokeDasharray="4 4" strokeOpacity={0.6} />
                <ReferenceLine y={-2} stroke="var(--status-flag)" strokeDasharray="4 4" strokeOpacity={0.6} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={tooltipDate} />} />
                {(['speech', 'typing', 'handwriting'] as const).map((k) => (
                  <Line key={k} dataKey={k} stroke={`var(--color-${k})`} strokeWidth={2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ChartContainer>
          </CardContent>
          <CardFooter className="flex-wrap gap-4 border-t text-[0.6875rem] text-muted-foreground">
            {modalities.map((m) => (
              <span key={m.key} className="inline-flex items-center gap-1.5">
                <i className="size-1.5 rounded-full" style={{ background: domainConfig[m.key].color }} /> {domainConfig[m.key].label}
              </span>
            ))}
            <span className="ml-auto">Dashed: watch −1σ / flag −2σ</span>
          </CardFooter>
        </Card>

        <Card className="col-span-12 [--card-spacing:--spacing(5)] md:col-span-6 xl:col-span-4">
          <CardHeader>
            <CardTitle className="text-lg font-normal">Alerts</CardTitle>
            <CardAction><Bell className="size-4 text-muted-foreground" aria-hidden /></CardAction>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            {alerts.length ? alerts.map((a) => (
              <div key={a.title} className="flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0">
                <div className="flex items-start justify-between gap-2">
                  <span>{a.title}</span>
                  <StatusBadge status={a.status} />
                </div>
                <span className="text-xs text-muted-foreground">{a.detail}</span>
              </div>
            )) : <p className="text-muted-foreground">No sustained changes from baseline.</p>}
          </CardContent>
          <CardFooter className="flex-wrap gap-3 border-t">
            <span className="inline-flex items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
              <CalendarClock className="size-3.5" aria-hidden /> Next clinic visit {fmtDate(NEXT_VISIT)}
            </span>
            <Button size="sm" variant="outline" className="ml-auto">
              <Share2 aria-hidden /> Share with neurologist
            </Button>
          </CardFooter>
        </Card>

        {modalities.map((m) => {
          const Icon = ICONS[m.key]
          return (
            <Card key={m.key} className="col-span-12 [--card-spacing:--spacing(5)] md:col-span-6 xl:col-span-4">
              <CardHeader>
                <CardTitle className="inline-flex items-center gap-2 text-lg font-normal">
                  <Icon className="size-4 text-muted-foreground" aria-hidden /> {m.label}
                </CardTitle>
                <CardAction><StatusBadge status={m.status} /></CardAction>
              </CardHeader>
              <CardContent>
                <Spark values={period.map((s) => s.z[m.key])} className="mb-4 h-10 w-full" />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 px-0 text-[0.6875rem] font-normal text-muted-foreground">Feature</TableHead>
                      <TableHead className="h-8 text-right text-[0.6875rem] font-normal text-muted-foreground">Baseline</TableHead>
                      <TableHead className="h-8 text-right text-[0.6875rem] font-normal text-muted-foreground">Now</TableHead>
                      <TableHead className="h-8 px-0 text-right text-[0.6875rem] font-normal text-muted-foreground">Δ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {m.features.map((f) => (
                      <TableRow key={f.key}>
                        <TableCell className="px-0 py-2 whitespace-normal">
                          {f.label}
                          {f.unit ? <span className="ml-1 text-[0.6875rem] text-muted-foreground">{f.unit}</span> : null}
                        </TableCell>
                        <TableCell className="py-2 text-right text-muted-foreground">{fmt(f.baseline, f.decimals)}</TableCell>
                        <TableCell className="py-2 text-right">{fmt(f.current, f.decimals)}</TableCell>
                        <TableCell className={cn('px-0 py-2 text-right', f.worse && Math.abs(f.change) >= 0.05 ? 'text-flag' : 'text-muted-foreground')}>
                          {signed(f.change * 100, 0)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <Collapsible className="mt-4 text-xs text-muted-foreground">
        <CollapsibleTrigger className="group inline-flex items-center gap-2 py-2">
          Session data <span className="opacity-70">{period.length} rows</span>
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Date', 'Speaking rate', 'DDK', 'Typing', 'Inter-key', 'Stroke vel.', 'Jerk', 'Index', 'Est. ALSFRS-R'].map((h) => (
                    <TableHead key={h} className="text-right font-normal text-muted-foreground first:text-left">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...period].reverse().map((s) => (
                  <TableRow key={s.t}>
                    <TableCell>{fmtDate(s.t)}</TableCell>
                    <TableCell className="text-right">{fmt(s.values.rate, 2)}</TableCell>
                    <TableCell className="text-right">{fmt(s.values.ddk, 1)}</TableCell>
                    <TableCell className="text-right">{fmt(s.values.wpm, 0)}</TableCell>
                    <TableCell className="text-right">{fmt(s.values.flight, 0)} ms</TableCell>
                    <TableCell className="text-right">{fmt(s.values.velocity, 2)}</TableCell>
                    <TableCell className="text-right">{fmt(s.values.jerk, 2)}</TableCell>
                    <TableCell className="text-right">{fmt(s.mfi, 1)}</TableCell>
                    <TableCell className="text-right">{fmt(s.alsfrs, 1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
