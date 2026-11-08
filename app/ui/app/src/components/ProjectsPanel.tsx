import { useMemo, useState } from "react";
import { EllipsisHorizontalIcon, PlusIcon, FolderIcon } from "@heroicons/react/24/outline";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { createPortal } from "react-dom";

interface ProjectRow {
  id: string;
  name: string;
  parentId?: string | null;
  chatCount: number;
}

interface ProjectsPanelProps {
  projects: ProjectRow[];
  selectedProjectId: string | null;
  onSelect: (id: string) => void;
  onNewProject: () => void;
  onRename: (id: string, currentName: string) => void;
  onDelete: (id: string) => void;
}

interface ProjectMenuState {
  projectId: string;
  name: string;
  top: number;
  left: number;
}

/**
 * Top-level projects list. Only root projects (parentId == null) render here —
 * subprojects are surfaced via the breadcrumb chips once you're inside a
 * project. Clicking a project filters the Chats panel below.
 */
export function ProjectsPanel({
  projects,
  selectedProjectId,
  onSelect,
  onNewProject,
  onRename,
  onDelete,
}: ProjectsPanelProps) {
  const [menu, setMenu] = useState<ProjectMenuState | null>(null);

  const topLevel = useMemo(
    () => projects.filter((p) => !p.parentId),
    [projects],
  );

  // Count direct children so we can show a "›" indicator.
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      if (p.parentId) {
        counts.set(p.parentId, (counts.get(p.parentId) ?? 0) + 1);
      }
    }
    return counts;
  }, [projects]);

  const openMenu = (projectId: string, name: string, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    // Flip above if not enough room below.
    let top = rect.bottom + 4;
    const estimatedHeight = 84;
    if (top + estimatedHeight > window.innerHeight - 8) {
      top = rect.top - estimatedHeight - 4;
    }
    let left = rect.right - 160;
    if (left < 8) left = 8;
    if (left + 160 > window.innerWidth - 8) {
      left = window.innerWidth - 160 - 8;
    }
    setMenu({ projectId, name, top, left });
  };

  return (
    <CollapsibleSection
      title="Projects"
      count={topLevel.length}
      defaultOpen
      className="shrink-0"
      panelClassName="flex flex-col gap-0.5 pt-1 overflow-y-auto max-h-40"
      actions={
        <button
          type="button"
          aria-label="New project"
          title="New project"
          onClick={onNewProject}
          className="flex h-5 w-5 items-center justify-center rounded-md text-fg-muted hover:text-fg focus:outline-none"
        >
          <PlusIcon className="h-3.5 w-3.5 stroke-current" />
        </button>
      }
    >
      {topLevel.length === 0 ? (
        <p className="px-2 py-1 text-xs text-fg-muted/70 select-none">
          No projects yet
        </p>
      ) : (
        topLevel.map((project) => {
          const isSelected = project.id === selectedProjectId;
          const childCount = childCounts.get(project.id) ?? 0;
          return (
            <div
              key={project.id}
              className={`group flex items-center relative text-sm rounded-lg ${
                isSelected
                  ? "bg-surface-hover text-fg"
                  : "text-fg-muted hover:bg-surface-hover"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(project.id)}
                className="flex-1 flex items-center min-w-0 px-2 py-1.5 text-left select-none focus:outline-none"
              >
                <FolderIcon className="mr-1.5 h-3.5 w-3.5 shrink-0 stroke-current" />
                <span className="truncate font-sans text-sm">
                  {project.name}
                </span>
                {project.chatCount > 0 && (
                  <span className="ml-1.5 shrink-0 text-[11px] tabular-nums text-fg-muted">
                    {project.chatCount}
                  </span>
                )}
                {childCount > 0 && (
                  <span
                    aria-label={`${childCount} subprojects`}
                    title={`${childCount} subprojects`}
                    className="ml-1 shrink-0 text-[11px] text-fg-muted/70"
                  >
                    ›
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label="Project actions"
                aria-haspopup="menu"
                aria-expanded={menu?.projectId === project.id}
                title="Project actions"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (menu?.projectId === project.id) {
                    setMenu(null);
                    return;
                  }
                  openMenu(project.id, project.name, e.currentTarget);
                }}
                className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-opacity hover:text-fg focus:outline-none ${
                  isSelected || menu?.projectId === project.id
                    ? "opacity-100"
                    : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:opacity-100"
                }`}
              >
                <EllipsisHorizontalIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })
      )}

      {menu &&
        createPortal(
          <div
            role="menu"
            aria-label="Project actions"
            style={{ top: menu.top, left: menu.left }}
            className="fixed z-50 w-40 overflow-hidden rounded-lg bg-surface py-1 text-sm text-fg shadow-lg ring-1 ring-black/10 dark:ring-white/10"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onRename(menu.projectId, menu.name);
                setMenu(null);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDelete(menu.projectId);
                setMenu(null);
              }}
              className="flex w-full items-center px-3 py-1.5 text-left text-sm text-red-500 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
            >
              Delete project
            </button>
          </div>,
          document.body,
        )}
    </CollapsibleSection>
  );
}