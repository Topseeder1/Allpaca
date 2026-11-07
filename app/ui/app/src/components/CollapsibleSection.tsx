import { useId, useState, type ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/24/outline";

export interface CollapsibleSectionProps {
  /** Section label shown in the header row. */
  title: string;
  /** Optional count badge, rendered only when > 0. */
  count?: number;
  /** Whether the section starts expanded. */
  defaultOpen?: boolean;
  /** Optional trailing controls (e.g. "Empty trash"). Not used yet. */
  actions?: ReactNode;
  /**
   * Classes for the outer <section>. Use this to make the widget participate in
   * the parent flex layout, e.g. `flex-1` for the main list or `shrink-0` for a
   * bounded panel so sections scroll independently instead of the whole sidebar.
   */
  className?: string;
  /**
   * Panel classes. The panel is a bare `flex flex-col` container with no gap,
   * so callers keep full control over spacing AND scroll behavior.
   */
  panelClassName?: string;
  children: ReactNode;
}

/**
 * A collapsible sidebar section: a header button with a chevron plus a panel
 * that unmounts when collapsed.
 *
 * State is intentionally local (useState) rather than persisted. The webview
 * origin differs between dev (:3001) and production (:52342), so localStorage
 * would appear to reset whenever the launch mode changes. Persistence belongs
 * on the settings row alongside `sidebar_open`.
 */
export function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  actions,
  className = "",
  panelClassName = "flex flex-col",
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={`flex min-h-0 flex-col gap-0.5 ${className}`}>
      {/* shrink-0 so the header never gets squeezed by a scrolling panel below it */}
      <div className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-hover">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left text-xs font-medium text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted"
        >
          <ChevronRightIcon
            className={`h-3.5 w-3.5 shrink-0 stroke-current transition-transform duration-150 ${
              open ? "rotate-90" : ""
            }`}
          />
          <span className="select-none truncate">{title}</span>
          {typeof count === "number" && count > 0 && (
            <span className="ml-0.5 shrink-0 select-none text-[11px] tabular-nums text-fg-muted">
              {count}
            </span>
          )}
        </button>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
      {open && (
        <div id={panelId} className={panelClassName}>
          {children}
        </div>
      )}
    </section>
  );
}