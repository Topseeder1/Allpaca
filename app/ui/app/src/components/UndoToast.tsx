interface UndoToastProps {
  message: string;
  undoLabel?: string;
  onUndo: () => void;
}

export function UndoToast({
  message,
  undoLabel = "Undo",
  onUndo,
}: UndoToastProps) {
  return (
    <div className="pointer-events-auto flex w-full items-center justify-between gap-3 rounded-lg bg-surface-hover px-4 py-2 text-sm text-fg shadow-lg ring-1 ring-black/10 dark:ring-white/10">
      <span className="min-w-0 truncate">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="shrink-0 font-medium text-blue-500 hover:text-blue-400 focus:outline-none"
      >
        {undoLabel}
      </button>
    </div>
  );
}