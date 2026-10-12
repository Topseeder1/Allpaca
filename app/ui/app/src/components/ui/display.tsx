import { clsx } from "clsx";
import { XMarkIcon } from "@heroicons/react/20/solid";

const colors = {
  // Status variants stay literal (contract: red/amber/blue/green never theme).
  red: "bg-red-50/80 dark:bg-red-950/50",
  neutral: "bg-surface-raised/80",
  amber: "bg-amber-50/80 dark:bg-amber-950/50",
  blue: "bg-blue-50/80 dark:bg-blue-950/50",
  green: "bg-green-50/80 dark:bg-green-950/50",
  zinc: "bg-surface-raised/80",
};

const textColors = {
  red: "text-red-600 dark:text-red-400",
  neutral: "text-fg-muted",
  amber: "text-amber-600 dark:text-amber-400",
  blue: "text-blue-600 dark:text-blue-400",
  green: "text-green-600 dark:text-green-400",
  zinc: "text-fg-muted",
};

const dismissButtonColors = {
  red: "text-red-400 hover:bg-red-100/50 hover:text-red-600 dark:text-red-500 dark:hover:bg-red-900/30 dark:hover:text-red-300",
  neutral: "text-fg-muted hover:bg-surface-hover hover:text-fg",
  amber:
    "text-amber-400 hover:bg-amber-100/50 hover:text-amber-600 dark:text-amber-500 dark:hover:bg-amber-900/30 dark:hover:text-amber-300",
  blue: "text-blue-400 hover:bg-blue-100/50 hover:text-blue-600 dark:text-blue-500 dark:hover:bg-blue-900/30 dark:hover:text-blue-300",
  green:
    "text-green-400 hover:bg-green-100/50 hover:text-green-600 dark:text-green-500 dark:hover:bg-green-900/30 dark:hover:text-green-300",
  zinc: "text-fg-muted hover:bg-surface-hover hover:text-fg",
};

export interface DisplayAction {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  loading?: boolean;
  gradientColors?: string;
}

interface DisplayProps {
  message: string;
  variant?: keyof typeof colors;
  onDismiss?: () => void;
  action?: DisplayAction;
  className?: string;
}

export const Display = ({
  message,
  variant = "neutral",
  onDismiss,
  action,
  className,
}: DisplayProps) => {
  const ActionButton = ({ action }: { action: DisplayAction }) => {
    // Inversion pair: bg = --color-fg (dark chip in light themes, light chip
    // in dark themes — exactly the old zinc-900/white behavior), text = the
    // inverse surface. Borders/hovers stay literal grays (universal).
    const buttonClass =
      "px-3 py-1.5 text-xs font-medium bg-fg text-surface border border-zinc-950/90 rounded-full shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-fg/90 dark:border-zinc-950/10 dark:hover:bg-fg/90";

    const content = (
      <span>{action.loading ? `${action.label}...` : action.label}</span>
    );

    if (action.href) {
      return (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass}
        >
          {content}
        </a>
      );
    }

    return (
      <button
        onClick={action.onClick}
        disabled={action.disabled}
        className={buttonClass}
      >
        {content}
      </button>
    );
  };

  return (
    <div
      className={clsx(
        "mx-auto flex w-full max-w-[730px] items-center justify-between rounded-2xl px-4 py-3 text-sm transition-all duration-200 backdrop-blur-sm",
        colors[variant],
        className,
      )}
    >
      <div className="flex items-center space-x-3 select-text">
        <span className={clsx("leading-relaxed", textColors[variant])}>
          {message}
        </span>
      </div>

      <div className="flex items-center space-x-3">
        {action && <ActionButton action={action} />}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className={clsx(
              "rounded-full p-1.5 cursor-pointer",
              dismissButtonColors[variant],
            )}
          >
            <XMarkIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};