import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProjectStats } from "@/api";

interface DeleteProjectDialogProps {
  projectId: string;
  projectName: string;
  onConfirm: (mode: "promote" | "delete") => void;
  onClose: () => void;
}

/**
 * Delete-project confirmation with two explicit choices. The two branches
 * diverge only in what happens to the chats inside the subtree:
 *
 *   - promote: chats survive and land in the Unfiled root.
 *   - delete : chats are soft-deleted into Recently Deleted for 30 days.
 *
 * Project structure is deleted either way. This dialog exists because
 * window.confirm does not work in the webview, and because the two branches
 * genuinely need distinct labels — not because deletion is irreversible for
 * the chats themselves (it isn't; the trash has them).
 */
export function DeleteProjectDialog({
  projectId,
  projectName,
  onConfirm,
  onClose,
}: DeleteProjectDialogProps) {
  const statsQuery = useQuery({
    queryKey: ["projects", "stats", projectId],
    queryFn: () => getProjectStats(projectId),
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  const chatCount = statsQuery.data?.chatCount ?? 0;
  const subCount = statsQuery.data?.subprojectCount ?? 0;
  const hasChildren =
    subCount > 0 || chatCount > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg bg-surface p-4 text-fg shadow-xl ring-1 ring-black/10 dark:ring-white/10">
        <h2 id="delete-project-title" className="mb-1 text-sm font-medium">
          Delete &ldquo;{projectName}&rdquo;?
        </h2>
        <p className="mb-3 text-xs text-fg-muted">
          This project and its {subCount} subproject
          {subCount === 1 ? "" : "s"} contain{" "}
          <strong className="text-fg">{chatCount}</strong> conversation
          {chatCount === 1 ? "" : "s"}. The project tree is deleted either way —
          choose where the conversations go:
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={!hasChildren}
            onClick={() => {
              onConfirm("promote");
              onClose();
            }}
            className="flex w-full flex-col items-start rounded-md border border-black/10 px-3 py-2 text-left text-sm text-fg hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted dark:border-white/10 disabled:opacity-50"
          >
            <span className="font-medium">Move conversations to Unfiled</span>
            <span className="mt-0.5 text-[11px] text-fg-muted">
              Chats are kept untouched. Nothing is deleted.
            </span>
          </button>
          <button
            type="button"
            disabled={!hasChildren}
            onClick={() => {
              onConfirm("delete");
              onClose();
            }}
            className="flex w-full flex-col items-start rounded-md border border-red-500/30 px-3 py-2 text-left text-sm text-fg hover:bg-red-500/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 dark:border-red-500/30 disabled:opacity-50"
          >
            <span className="font-medium text-red-500">
              Also delete the {chatCount} conversation
              {chatCount === 1 ? "" : "s"}
            </span>
            <span className="mt-0.5 text-[11px] text-fg-muted">
              They move to Recently Deleted and can be restored for 30 days.
            </span>
          </button>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm text-fg-muted hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}