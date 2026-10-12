import * as Headless from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";

/**
 * Triple-chip color preview rendered beside an option's label.
 *
 * Each field is any CSS color string: a literal (`"#1c1917"`) or a
 * `var(--token)` reference. The Theme dropdown uses this to show what a
 * theme looks like (surface / fg / accent) before the user commits to it.
 */
export interface SelectSwatch {
  surface: string;
  fg: string;
  accent: string;
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  /** Optional second line under the label. */
  description?: string;
  /** Optional three-chip color preview. Omit for non-themed pickers (e.g. fonts). */
  swatch?: SelectSwatch;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SelectOption<T>>;
  className?: string;
  disabled?: boolean;
  /** Passed through to the trigger. Use when no Label sits beside the control. */
  "aria-label"?: string;
  /** Passed through to the trigger so a sibling Label's htmlFor can target it. */
  id?: string;
}

/**
 * Select — a controlled dropdown built on Headless UI's Listbox.
 *
 * API shape mirrors the rest of the kit: `value` + `onChange`, no internal
 * state beyond Headless UI's own open/close. Pair with <Field>/<Label> from
 * fieldset.tsx; the trigger carries `data-slot="control"` so the Field's
 * margin rules (`[&>[data-slot=label]+[data-slot=control]]:mt-3`) apply.
 *
 * NOTE ON GENERICS: Headless UI's Listbox declares two type parameters —
 * `<TTag extends ElementType, TType = string>`. The FIRST is the `as` tag,
 * the SECOND is the value type. Passing our value type as the first
 * parameter (`<Listbox<T>>`) is what caused TS2344. We deliberately pass NO
 * explicit generic; the value type infers from `value`/`onChange`, keeping
 * `T` flowing end-to-end (ThemeValue / FontValue narrow at the call site)
 * without a cast.
 */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  className,
  disabled = false,
  ...props
}: SelectProps<T>) {
  const selected = options.find((o) => o.value === value);

  return (
    <Headless.Listbox value={value} onChange={onChange} disabled={disabled}>
      <div className={clsx("relative", className)}>
        <Headless.ListboxButton
          {...props}
          data-slot="control"
          className={clsx(
            // Layout
            "group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
            // Surface — semantic tokens
            "bg-surface text-fg ring-1 ring-border ring-inset",
            "hover:bg-surface-hover",
            // Focus
            "outline-hidden data-focus:ring-2 data-focus:ring-accent",
            // Disabled
            "data-disabled:cursor-not-allowed data-disabled:opacity-50",
            // Typography — matches Label/Description in fieldset.tsx
            "text-base/6 sm:text-sm/6",
          )}
        >
          {selected?.swatch && <SwatchChips swatch={selected.swatch} />}
          <span className="min-w-0 flex-1 truncate">
            {selected?.label ?? ""}
          </span>
          <ChevronUpDownIcon
            aria-hidden="true"
            className="size-5 shrink-0 text-fg-muted"
          />
        </Headless.ListboxButton>

        <Headless.ListboxOptions
          transition
          anchor="bottom start"
          className={clsx(
            // Anchored popover — width matches the trigger via the
            // `--button-width` var Headless UI sets in anchor mode.
            "z-50 w-(--button-width) max-h-80 overflow-auto",
            // Surface
            "rounded-lg bg-surface-raised py-1 shadow-lg ring-1 ring-border ring-inset",
            // Typography
            "text-base/6 sm:text-sm/6 text-fg",
            // Transition
            "transition duration-100 ease-out",
            "data-closed:opacity-0",
          )}
        >
          {options.map((option) => (
            <Headless.ListboxOption
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              className={({ focus, selected: isSelected, disabled: isDisabled }) =>
                clsx(
                  "group flex cursor-default items-center gap-3 px-3 py-2 select-none",
                  // Focus highlight
                  focus && "bg-surface-hover",
                  // Selected emphasis (check icon marks it too — see below)
                  isSelected && "font-medium",
                  // Disabled
                  isDisabled && "opacity-50",
                )
              }
            >
              {({ selected: isSelected }) => (
                <>
                  {option.swatch ? (
                    <SwatchChips swatch={option.swatch} />
                  ) : (
                    // Empty placeholder keeps labels column-aligned across
                    // mixed swatch / no-swatch lists.
                    <span aria-hidden="true" className="w-12 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.label}</span>
                    {option.description && (
                      <span className="block truncate text-xs text-fg-muted">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <CheckIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-fg"
                    />
                  )}
                </>
              )}
            </Headless.ListboxOption>
          ))}
        </Headless.ListboxOptions>
      </div>
    </Headless.Listbox>
  );
}

/**
 * Three overlapping chips previewing an option's surface, foreground, and
 * accent. Decorative only — hidden from the a11y tree; the option's `label`
 * carries the accessible name.
 */
function SwatchChips({ swatch }: { swatch: SelectSwatch }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center -space-x-1.5"
    >
      <span
        className="size-5 rounded-full ring-1 ring-border"
        style={{ backgroundColor: swatch.surface }}
      />
      <span
        className="size-5 rounded-full ring-1 ring-border"
        style={{ backgroundColor: swatch.fg }}
      />
      <span
        className="size-5 rounded-full ring-1 ring-border"
        style={{ backgroundColor: swatch.accent }}
      />
    </span>
  );
}