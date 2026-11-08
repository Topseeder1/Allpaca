import { useEffect, useRef, useState } from "react";

interface NewProjectDialogProps {
  title: string;
  initialName?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/**
 * Simple name-input modal. Used for both "New project", "New subproject",
 * and "Rename project" — the only difference is the title and submit label.
 *
 * Not using window.confirm/prompt on purpose: WebView2 can be configured to
 * suppress native dialogs (AreDefaultScriptDialogsEnabled), which silently
 * returns null/false — the same class of bug that made Delete appear broken
 * earlier. A real modal always works.
 */
export function NewProjectDialog({
  title,
  initialName = "",
  submitLabel,
  onSubmit,
  onClose,
}: NewProjectDialogProps) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

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

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-project-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-surface p-4 text-fg shadow-xl ring-1 ring-black/10 dark:ring-white/10">
        <h2 id="new-project-title" className="mb-2 text-sm font-medium">
          {title}
        </h2>
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Project name"
          className="w-full rounded-md border border-black/10 bg-transparent px-2 py-1.5 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-fg-muted dark:border-white/10"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1 text-sm text-fg-muted hover:bg-surface-hover focus:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="rounded-md bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}