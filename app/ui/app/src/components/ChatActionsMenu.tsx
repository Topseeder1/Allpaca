import { useEffect, useRef } from "react";

interface ChatActionsMenuProps {
  top: number;
  left: number;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ChatActionsMenu({
  top,
  left,
  onRename,
  onDelete,
  onClose,
}: ChatActionsMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);

  // Move focus into the menu so keyboard users land on the first action and
  // Escape returns control to the trigger.
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;

      // Clicks on the anchor button are handled by the button's own onClick
      // (toggle). If the outside-close fired first it would close and then
      // immediately reopen, so ignore the anchor here.
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

    // Close on any scroll (capture catches the sidebar's own scroll container)
    // so the fixed-position menu never detaches from its anchor row.
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

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Chat actions"
      style={{ top, left }}
      className="fixed z-50 w-40 overflow-hidden rounded-lg bg-surface py-1 text-sm text-fg shadow-lg ring-1 ring-black/10 dark:ring-white/10"
    >
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
        onClick={onDelete}
        className="flex w-full items-center px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-hover focus:bg-surface-hover focus:outline-none"
      >
        Delete
      </button>
    </div>
  );
}