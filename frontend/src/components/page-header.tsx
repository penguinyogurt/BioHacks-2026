import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** The one header every workspace tab uses: eyebrow, title, optional description, actions and extra rows. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: {
  eyebrow: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl bg-card px-5 pt-5 pb-4 ring-1 ring-border backdrop-blur-md', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="font-brand mt-3 text-[clamp(2rem,3.2vw,3rem)] leading-none">{title}</h2>
          {description ? <p className="mt-3 max-w-3xl text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
