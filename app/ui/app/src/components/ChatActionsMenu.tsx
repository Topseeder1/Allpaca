import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon, CheckIcon } from "@heroicons/react/24/outline";

interface ProjectOption {
  id: string;
  name: string;
  parentId?: string | null;
}

interface ChatActionsMenuProps {
  top: number;
  left: number;
  /** When true, the archive entry reads "Unarchive" and toggles the other way. */
  isArchived?: boolean;
  /** The project the chat is currently in (undefined = Unfiled). */
  currentProjectId?: string | null;
  /** All projects the user can move the chat into. Nested via parentId. */
  projects: ProjectOption[];
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onMoveToProject: (projectId: string | null) => void;
  onCreateProject?: () => void;
  onClose: () => void;
}

/**
 * A DOM menu for chat actions. Unlike the native shell menu (window.menu),
 * this is drawn by React so left-clicks can open it — the native menu only
 * fires on trusted right-clicks in WebView2.
 *
 * Two states: the primary action list, and a "Move to project" submenu that
 * replaces the list with a flat project picker.
 */
export function ChatActionsMenu({
  top,
  left,
  isArchived = false,
  currentProjectId,
  projects,
  onRename,
  onArchive,
  onDelete,
  onMoveToProject,
  onCreateProject,
  onClose,
}: ChatActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"main" | "move">("main");

  useEffect(() => {
    firstItemRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-chat-menu-trigger]")) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    const handleDetach = () => onClose();

    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("scroll", handleDetach, true);
    window.addEventListener("resize", handleDetach);
    window.addEventListener("blur", handleDetach);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("scroll", handleDetach, true);
      window.removeEventListener("resize", handleDetach);
      window.removeEventListener("blur", handleDetach);
    };
  }, [onClose]);

  // Build a display order for the flat project list — walk the tree so
  // children follow their parents with an indent, without recursion.
  const orderedProjects = (() => {
    const byParent = new Map<string | null, ProjectOption[]>();
    for (const p of projects) {
      const key = p.parentId ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(p);
    }
    const out: Array<ProjectOption & { depth: number }> = [];
    const walk = (parentId: string | null, depth: number) => {
      const children = byParent.get(parentId) ?? [];
      for (const c of children) {
        out.push({ ...c, depth });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  })();

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Chat actions"
      style={{ top, left }}
      className="fixed z-50 w-56 overflow-hidden rounded-lg bg-surface py-1 text-sm text-fg shadow-lg ring-1 ring-black/10 dark:ring-white/10"
    >
      {mode === "main" ? (
        <>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={onRename}
            className="flex w-full items-center px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={onArchive}
            className="flex w-full items-center px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          >
            {isArchived ? "Unarchive" : "Archive"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setMode("move")}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          >
            <span>Move to project</span>
            <ChevronRightIcon className="h-3.5 w-3.5 stroke-current text-fg-muted" />
          </button>
          <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
          <button
            type="button"
            role="menuitem"
            onClick={onDelete}
            className="flex w-full items-center px-3 py-1.5 text-left text-sm text-red-500 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <div className="px-3 pb-1 pt-1 text-[11px] font-medium text-fg-muted">
            Move to project
          </div>
          <button
            ref={firstItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              onMoveToProject(null);
              onClose();
            }}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          >
            <span className="italic text-fg-muted">Unfiled</span>
            {!currentProjectId && (
              <CheckIcon className="h-3.5 w-3.5 stroke-current text-fg" />
            )}
          </button>
          <div className="max-h-64 overflow-y-auto">
            {orderedProjects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  style={{ paddingLeft: 12 + p.depth * 12 }}
                  onClick={() => {
                    if (isCurrent) {
                      onClose();
                      return;
                    }
                    onMoveToProject(p.id);
                    onClose();
                  }}
                  className="flex w-full items-center justify-between pr-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
                >
                  <span className="truncate">{p.name}</span>
                  {isCurrent && (
                    <CheckIcon className="h-3.5 w-3.5 shrink-0 stroke-current text-fg" />
                  )}
                </button>
              );
            })}
          </div>
          {onCreateProject && (
            <>
              <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCreateProject();
                  onClose();
                }}
                className="flex w-full items-center px-3 py-1.5 text-left text-sm text-blue-500 hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
              >
                New project…
              </button>
            </>
          )}
          <div className="my-1 h-px bg-black/10 dark:bg-white/10" />
          <button
            type="button"
            role="menuitem"
            onClick={() => setMode("main")}
            className="flex w-full items-center px-3 py-1.5 text-left text-sm text-fg-muted hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
          >
            ← Back
          </button>
        </>
      )}
    </div>
  );
}