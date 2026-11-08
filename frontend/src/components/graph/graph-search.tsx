import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { search, type SearchIndex } from './graph-data'
import { TypeGlyph } from '@/components/discovery/drkg-legend'
import { typeHex } from './graph-canvas'

const fmt = (n: number) => n.toLocaleString('en-US')
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * Always-visible search over every entity's label and id. `/` or Ctrl/Cmd+K
 * focuses it; ArrowUp/Down + Enter pick; Esc closes. No open/close animation:
 * it is keyboard-driven and used constantly.
 */
export function GraphSearch({
  index,
  ids,
  degree,
  types,
  typeNames,
  only,
  onPick,
}: {
  index: SearchIndex | null
  ids: string[] | null
  degree: Uint32Array | null
  types: Uint8Array
  typeNames: string[]
  only: Set<number>
  onPick: (row: number) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()
  const q = useDeferredValue(query)
  const results = useMemo(() => (index ? search(q, index, degree, types, only, 30) : []), [q, index, degree, types, only])
  const stale = q !== query

  useEffect(() => setActive(0), [q, only])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const pick = (row: number) => {
    onPick(row)
    setOpen(false)
    input.current?.blur()
  }

  const show = open && query.trim().length > 0

  return (
    <div className="relative w-full">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show && results[active] !== undefined ? `${listId}-${active}` : undefined}
          aria-label="Search all DRKG entities by name or id"
          placeholder="Search 97,238 entities — riluzole, SOD1, Gene::6647…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(results.length - 1, a + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(0, a - 1))
            } else if (e.key === 'Enter' && results[active] !== undefined) {
              e.preventDefault()
              pick(results[active])
            } else if (e.key === 'Escape') {
              e.preventDefault()
              e.stopPropagation()
              if (query && show) setQuery('')
              else input.current?.blur()
            }
          }}
          className="h-10 w-full rounded-lg bg-popover pr-16 pl-9 text-sm shadow-xs ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setQuery('')}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : (
            <kbd className="rounded border border-border bg-background px-1.5 font-sans text-[0.6875rem] text-muted-foreground">{isMac ? '⌘K' : '/'}</kbd>
          )}
        </div>
      </div>

      {show ? (
        <div className="absolute top-full right-0 left-0 z-20 mt-1.5 overflow-hidden rounded-lg bg-popover shadow-lg ring-1 ring-border">
          {!index ? (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading names…
            </p>
          ) : results.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">
              {stale ? 'Searching…' : `No entity matches “${query.trim()}”${only.size ? ' in the selected types' : ''}.`}
            </p>
          ) : (
            <ul ref={list} id={listId} role="listbox" aria-label="Matching entities" className={cn('max-h-[min(26rem,60dvh)] overflow-y-auto py-1', stale && 'opacity-70')}>
              {results.map((row, i) => {
                const t = types[row]
                return (
                  <li
                    key={row}
                    id={`${listId}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(i)}
                    onClick={() => pick(row)}
                    className={cn('grid cursor-pointer grid-cols-[0.875rem_minmax(0,1fr)_auto] items-center gap-x-2.5 px-3 py-1.5 text-sm', i === active && 'bg-accent')}
                  >
                    <TypeGlyph type={typeNames[t]} color={typeHex(t)} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{index.label[row] || `Entity ${row}`}</span>
                      <span className="block truncate font-mono text-[0.6875rem] text-muted-foreground">{ids?.[row] ?? typeNames[t]}</span>
                    </span>
                    {degree ? <span className="text-xs text-muted-foreground tabular-nums">{fmt(degree[row])}</span> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
