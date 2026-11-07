import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A glass surface.
 *
 * The page sits on an animated dither texture, so sections can't be flat
 * blocks of solid colour — that would cover the thing that gives the page
 * depth. Instead each one is a translucent pane: the texture stays faintly
 * visible through it, which is what makes the layout read as floating rather
 * than stacked.
 *
 * Two details carry most of the effect. The top edge gets a one-pixel
 * highlight, because real glass catches light where it meets air and without
 * it the pane looks like a flat grey rectangle. And the blur is `backdrop`,
 * not a filter on the content — blurring the content itself would soften the
 * data, which is the one thing that has to stay sharp.
 */
export function Panel({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "header";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(
        "relative isolate overflow-hidden rounded-2xl",
        // 88%, not 28%. Dropping the opacity to show more texture inverted
        // the figure/ground: the composited panel measured DARKER than the
        // dither behind it, so the panes read as holes punched in a busy
        // field rather than as glass floating over one, and 11px label text
        // fell to 4.10:1. The texture belongs in the gaps between panels,
        // which is where it is actually visible — a pane has to be a
        // definite, quieter surface for the data to sit on.
        "border border-white/[0.09] bg-surface/[0.88] backdrop-blur-2xl backdrop-saturate-150",
        // Two edges, not a box: a bright top edge where the pane catches
        // light, and a dark drop below it so the pane reads as lifted off the
        // ground rather than drawn onto it.
        "shadow-[0_1px_0_0_rgba(255,255,255,0.08)_inset,0_1px_40px_-8px_rgba(0,0,0,0.5)_inset,0_32px_64px_-32px_rgba(0,0,0,0.85)]",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Section heading + supporting line, the same shape in every panel. */
export function PanelHeader({
  id,
  title,
  children,
  action,
  className,
}: {
  id?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-6", className)}>
      <div>
        <h2 id={id} className="text-xl leading-tight">
          {title}
        </h2>
        {children && (
          <p className="mt-1.5 max-w-[68ch] text-sm leading-normal text-ink-soft">
            {children}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
