import { ChevronRightIcon, PlusIcon } from "@heroicons/react/24/outline";

interface BreadcrumbProject {
  id: string;
  name: string;
}

interface ProjectBreadcrumbProps {
  breadcrumb: BreadcrumbProject[];
  childProjects: BreadcrumbProject[];
  onNavigate: (id: string | null) => void;
  onNewSubproject: () => void;
}

/**
 * Breadcrumb + child-project chip strip. Rendered above the Chats section
 * when a project is selected, per the filter model. Each crumb segment and
 * each child chip is clickable to drill in/out.
 */
export function ProjectBreadcrumb({
  breadcrumb,
  childProjects,
  onNavigate,
  onNewSubproject,
}: ProjectBreadcrumbProps) {
  return (
    <div className="flex flex-col gap-1 px-2 py-1 shrink-0">
      <nav
        aria-label="Project breadcrumb"
        className="flex flex-wrap items-center gap-0.5 text-xs text-fg-muted"
      >
        <button
          type="button"
          onClick={() => onNavigate(null)}
          className="rounded px-1 py-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted"
        >
          Projects
        </button>
        {breadcrumb.map((segment, i) => (
          <span key={segment.id} className="flex items-center gap-0.5">
            <ChevronRightIcon className="h-2.5 w-2.5 shrink-0 stroke-current opacity-60" />
            <button
              type="button"
              onClick={() => onNavigate(segment.id)}
              className={`rounded px-1 py-0.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted hover:bg-surface-hover ${
                i === breadcrumb.length - 1
                  ? "text-fg font-medium"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {segment.name}
            </button>
          </span>
        ))}
      </nav>

      {(childProjects.length > 0 || true) && (
        <div className="flex flex-wrap items-center gap-1">
          {childProjects.map((child) => (
            <button
              key={child.id}
              type="button"
              onClick={() => onNavigate(child.id)}
              className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted dark:border-white/10"
            >
              {child.name}
            </button>
          ))}
          <button
            type="button"
            onClick={onNewSubproject}
            className="flex items-center gap-0.5 rounded-full border border-dashed border-black/10 px-2 py-0.5 text-[11px] text-fg-muted hover:bg-surface-hover hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted dark:border-white/10"
          >
            <PlusIcon className="h-2.5 w-2.5 stroke-current" />
            <span>Subproject</span>
          </button>
        </div>
      )}
    </div>
  );
}