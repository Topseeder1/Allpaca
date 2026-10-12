// File: docs/THEMING.md
# Allpaca Theming & Font System — Internal Technical Guide

> Scope: the complete runtime theming + font-selection architecture in `app/ui/app`.
> Read this before touching any color, font, or theme file. It documents how the
> system works, why it is built this way, how to extend it, how to rebuild it from
> scratch, and how to debug it.

---

## 0. Mental model (30 seconds)

Three layers, three concerns:

1. **Build time** — Tailwind v4 compiles `@theme` token declarations into CSS custom
   properties (emitted inside `@layer theme`) and generates utility classes that
   *reference* those properties (`bg-surface` → `background-color: var(--color-surface)`).
2. **Runtime** — plain, unlayered CSS rules keyed on `<html data-theme="…">` /
   `<html data-font="…">` re-declare those same custom properties. Unlayered CSS
   always beats `@layer theme`, so the rebind wins **with zero rebuild**.
3. **Bootstrap** — a synchronous inline `<script>` in `index.html` reads
   `localStorage` *before the stylesheet loads* and writes `data-font`,
   `data-theme`, and `data-theme-scheme` onto `<html>`. This is what makes theme
   choice survive reload with no flash (FOUC).

Rule of thumb: **components never name hex values or palette utilities; they name
the 8 semantic tokens. Themes are data.**

---

## 1. Build configuration (do not touch without reading this)

| Item | File | Fact |
|---|---|---|
| Tailwind integration | `app/ui/app/vite.config.ts` | `tailwindcss()` from `@tailwindcss/vite` (v4-native Vite transform). There is **no** `postcss.config` for Tailwind. |
| PostCSS pass | `app/ui/app/vite.config.ts` | `postcss-preset-env` targeting Safari 14 with **`"custom-properties": true`**. This keeps `var()` indirection intact — it is *required* for runtime theme switching. Do not change it. |
| Package type | `app/ui/app/package.json` | `"type": "module"` — ESM everywhere. |
| `tailwind.config.js` | **DELETED** | Tailwind v4 never auto-loads JS configs (only an explicit `@config` directive does; none exists). It also used `require()` inside ESM. It was orphaned three independent ways. **Never resurrect it.** If you need a JS config, use `@config "./tailwind.config.js";` explicitly at the top of `src/index.css`. |
| Headless UI | `package.json` | `@headlessui/react ^2.2.4` — v2 API (`Listbox`/`ListboxButton`/`ListboxOptions`/`ListboxOption`). |

**Value constraint:** because of the Safari-14 downlevel pass, keep all theme token
values in **hex or rgb**. Avoid `oklch()` / `color-mix()` in theme files —
`preset-env` will transpile them and freeze the values, breaking runtime rebinds.

---

## 2. The 8-token contract

Declared once in `app/ui/app/src/styles/themes/_contract.css` inside a `@theme {}`
block. The names are **frozen**. Every theme file and every migrated component is
written against exactly these names.

| Token | Purpose | Utility |
|---|---|---|
| `--color-surface` | Base canvas: page bg, main chat area | `bg-surface` |
| `--color-surface-raised` | Elevated: cards, panels, dropdowns, code blocks | `bg-surface-raised` |
| `--color-surface-hover` | Hover/active on interactive surfaces | `hover:bg-surface-hover` |
| `--color-fg` | Primary text & icons | `text-fg` |
| `--color-fg-muted` | Secondary text, placeholders, hints | `text-fg-muted` |
| `--color-border` | Dividers, input outlines, table/cell borders | `border-border`, `ring-border` |
| `--color-accent` | Brand: primary buttons, active pills, focus rings | `bg-accent`, `ring-accent`, `text-accent` |
| `--color-accent-fg` | Text/icons *on top of* accent | `text-accent-fg` |

Contract rules:

1. **Add-only, never rename.** Renaming = 40+ component sweep. Adding a token at
   the bottom of `_contract.css` is non-breaking (themes inherit the default).
2. `_contract.css` values reproduce the light appearance — they are the fallback
   when no `data-theme` matches.
3. **Status colors are never tokens.** red/green/blue/amber/orange stay literal in
   components and kit variants (error states must read identically in every theme,
   including high-contrast). Same for named brand buttons (`red`, `green`,
   `indigo`, …) in `ui/button.tsx` and ui/badge colors.

---

## 3. File inventory

### System files (the machinery)

```
app/ui/app/
├── index.html
│     <head> inline bootstrap script (fonts + themes) — MUST precede the
│     stylesheet <link>. Also hosts the webview <script> block (do not delete).
│     <body class="bg-surface select-text">
├── tailwind.config.js            — DELETED (orphaned, see §1)
└── src/
    ├── index.css                 — Tailwind entry; @custom-variant dark (re-keyed);
    │                               @imports: tailwindcss, typography plugin, katex,
    │                               ./styles/index.css
    └── styles/
        ├── index.css             — style-tree entrypoint; import order matters:
        │                           fonts/roles → fonts/options → themes/_contract →
        │                           themes/*.css (theme files LAST, so unlayered
        │                           overrides sit after contract defaults)
        ├── fonts/
        │   ├── roles.css         — @theme tokens: --font-sans, --font-rounded
        │   └── options.css       — :root --font-stack-* catalog (system/rounded/
        │                           mono/serif) + unlayered html[data-font="…"]
        │                           rebinds of --font-sans + disabled @font-face
        │                           template for Batch "bundle brand font"
        └── themes/
            ├── _contract.css     — the 8 tokens, light defaults
            ├── allpaca-dark.css  — [data-theme="allpaca-dark"] (boot default)
            ├── allpaca-light.css
            ├── sepia.css         → light scheme
            ├── high-contrast.css → dark scheme
            ├── nord.css          → dark scheme (canonical Nord hexes)
            └── solarized-dark.css→ dark scheme (canonical Solarized)
```

### Feature files

| File | Role |
|---|---|
| `src/lib/appearance.ts` | Single source for: `ThemeValue`/`FontValue` unions, `THEME_OPTIONS`, `FONT_OPTIONS`, `THEME_SCHEME` (theme→scheme mirror map), `DEFAULT_*`, `getTheme/getFont` (localStorage readers, try/catch'd), `resolveThemeName` (system→concrete), `setTheme/setFont` (localStorage + `<html data-*>` writers). |
| `src/components/ui/select.tsx` | The Select primitive (Headless UI `Listbox` wrapper) with optional swatch rendering. Generic-safe (see §5). |
| `src/components/Settings.tsx` | Appearance section at top of fieldset: Theme + Font `<Select>`s, hidden swatch-probe `<div>`s, `handleThemeChange`/`handleFontChange`, appearance included in `handleResetToDefaults` (reset synchronously, before any async work). |

### Migrated consumers (token vocabulary)

`index.html` (body), `src/components/layout/layout.tsx` (SidebarLayout),
`ChatSidebar.tsx`, `ChatForm.tsx` (composer, send button = `bg-accent text-accent-fg`),
`MessageList.tsx`, `Message.tsx` (bubbles, tool results), `ThinkButton.tsx`,
`WebSearchButton.tsx`, `ModelPicker.tsx`, `FileUpload.tsx`, `CopyButton.tsx`
(md variant), `StreamingMarkdownContent.tsx` (code blocks, tables, prose), and UI kit:
`ui/button.tsx` (outline/plain variants + focus/disabled), `ui/switch.tsx` (track),
`ui/input.tsx`, `ui/fieldset.tsx` (Label/Description/Legend), `ui/text.tsx`,
`ui/slider.tsx`, `ui/display.tsx` (neutral/zinc variants), `ui/badge.tsx` (zinc).

**Zero colors, never needed editing:** `ui/link.tsx`, `Chat.tsx`, `Logo.tsx`,
`DisplayLogin/DisplayStale/DisplayUpgrade.tsx` (thin wrappers over `ui/display.tsx`).

**Never themed by contract:** Onboarding route (`main.light-only` + hardcoded
`bg-white text-neutral-950` in `Onboarding.tsx`), status red/green/blue/amber,
named color buttons, the FileUpload neutral scrim (depth-cue family, like shadows).

---

## 4. Runtime wiring

### 4.1 Bootstrap script (`index.html`, `<head>`)

Contract:

```js
// reads (synchronously, before CSS):
localStorage["allpaca:font"]  → <html data-font>          (default "system")
localStorage["allpaca:theme"] → resolved                   (default "system")
// resolution:
schemeMap = { "allpaca-dark":"dark", "allpaca-light":"light", "sepia":"light",
              "high-contrast":"dark", "nord":"dark", "solarized-dark":"dark" }
// "system" (or unknown value) → matchMedia("(prefers-color-scheme: dark)")
//   → dark ? "allpaca-dark" : "allpaca-light"
// writes THREE attributes:
data-font, data-theme, data-theme-scheme
// listener:
matchMedia(...).addEventListener("change", …) re-applies ONLY if stored pref is "system"
```

Positional requirements (both non-negotiable):

1. **Before** the `<link rel="stylesheet" href="/src/index.css" />` tag — it must
   run before CSS applies or you get FOUC.
2. Inside the existing `<head>`; the `<html style="overflow: hidden">` attr and the
   bottom webview `<script>` block (file picker / context menu / key handling) are
   load-bearing and must survive any edit to this file.

### 4.2 React side (`src/lib/appearance.ts`)

- **Boot rule:** React *reads* `documentElement.dataset` state via `getTheme()` /
  `getFont()` as `useState` initializers. **React never writes the attributes at
  mount** — the bootstrap already did. Writing at mount = second flicker.
- **Write path (user interaction only):** `setTheme(v)` / `setFont(v)` write
  localStorage (try/catch — private mode can throw) AND the `<html>` attributes, so
  the swap is instant with no reload and no network request.
- `resolveThemeName(theme)` maps `"system"` → concrete name for the current OS
  scheme; `THEME_SCHEME` provides the theme→scheme lookup for `data-theme-scheme`.

### 4.3 `dark:` variant (`src/index.css`)

```css
@custom-variant dark {
  &:where([data-theme-scheme="dark"], [data-theme-scheme="dark"] *) {
    &:not(.light-only, .light-only *) {
      @slot;
    }
  }
}
```

- Keyed off the **resolved scheme attribute**, not `prefers-color-scheme`. That is
  why every existing `dark:` utility in legacy components flips the instant a dark
  theme is chosen — before any component migrates to tokens.
- The `.light-only` exclusion is **deliberate**: `Onboarding.tsx` renders
  `main.light-only` with hardcoded light colors; without the exclusion, dark
  variants would leak onto it. Do not "simplify" it away. `.light-only { color-scheme: light }`
  also remains in `@layer base`.

---

## 5. Select primitive notes (`ui/select.tsx`)

- **Generics:** Headless v2 `Listbox` declares `<TTag extends ElementType, TType>`.
  The FIRST param is the `as` tag, NOT the value type. `<Headless.Listbox<T>>` with
  `T extends string` throws `TS2344`. **Pass no explicit generic** — `TType` infers
  from `value`/`onChange` and flows `ThemeValue`/`FontValue` end-to-end.
- Trigger carries **`data-slot="control"`** — `fieldset.tsx`'s `Field` spacing rules
  (`[&>[data-slot=label]+[data-slot=control]]:mt-3`) key on it. Omit it and the
  label sits flush against the button.
- Popover: `anchor="bottom start"` + `w-(--button-width)` (Headless sets the var).
- Swatches: `SelectSwatch { surface, fg, accent }` per option; `SwatchChips` renders
  three overlapping `size-5` chips with `ring-border` separators; swatchless rows
  reserve a `w-12` placeholder for column alignment.

### Swatch probe pattern (Settings.tsx)

Zero hex duplication between JS and CSS: a hidden absolutely-positioned container
(`ref={themeProbesRef}`) renders one `<div data-probe-key={value}
data-theme={resolveThemeName(value)} />` per `THEME_OPTIONS` entry. A mount-time
`useEffect` reads `getComputedStyle(el).getPropertyValue("--color-surface" |
"--color-fg" | "--color-accent")` per probe into `themeSwatches`, which feeds
`themeSelectOptions`. **The theme CSS files stay the single source of truth.** If you
add a theme and swatches for it come back empty, this pipeline is where to look.

---

## 6. How to: add a new theme

Four places — all must stay in sync (this is the registry obligation):

1. **`src/styles/themes/<name>.css`** (new file):

   ```css
   [data-theme="<name>"] {
     color-scheme: dark;            /* or light */
     --color-surface:        #…;
     --color-surface-raised: #…;
     --color-surface-hover:  #…;
     --color-fg:             #…;
     --color-fg-muted:       #…;
     --color-border:         #…;
     --color-accent:         #…;
     --color-accent-fg:      #…;
   }
   ```
   Values in hex only (§1). Check contrast: `fg` on `surface`, `accent-fg` on `accent`.

2. **`src/styles/index.css`** — append `@import "./themes/<name>.css";` (order within
   the theme block doesn't matter; each selector is unique).

3. **`index.html` bootstrap `schemeMap`** — add `"<name>": "dark"|"light"`.

4. **`src/lib/appearance.ts`** — add to the `ThemeValue` union, `THEME_SCHEME`,
   and `THEME_OPTIONS`.

Acceptance: dev-console
`document.documentElement.setAttribute('data-theme','<name>')` recolors the whole
app instantly; reload persists it; swatch appears in the Theme dropdown.

## 7. How to: add a new font

**System stack** (no font files):
`fonts/options.css` → add `--font-stack-<name>` to the `:root` catalog and
`html[data-font="<name>"] { --font-sans: var(--font-stack-<name>); }` to the
selection layer → in `appearance.ts` add to `FontValue` + `FONT_OPTIONS`. Done.

**Bundled font** (`Inter`, `Geist`, etc. — confirm OFL license):
1. Variable-weight `*.woff2` → `app/ui/app/public/fonts/`.
2. In `fonts/options.css`, un-comment/extend the `@font-face` template:
   `font-weight: 100 900` (one file, all weights), `font-display: swap`,
   `src: url("/fonts/<File>.woff2") format("woff2")`.
3. Then the same catalog + selection + union + options steps as above.
**Rebind mechanics:** only `--font-sans` is user-rebindable. `--font-rounded` is a
design accent and intentionally never rebinds.

## 8. How to: migrate a component to tokens

Mapping (mechanical, safe):

| Legacy | Token |
|---|---|
| `bg-white dark:bg-neutral-900` | `bg-surface` |
| `bg-neutral-100 dark:bg-neutral-800` (cards/panels/dropdowns) | `bg-surface-raised` |
| `hover:bg-neutral-*` (list rows, menu items) | `hover:bg-surface-hover` |
| `text-neutral-950` / `text-black dark:text-neutral-100` | `text-fg` |
| `text-neutral-500/400` | `text-fg-muted` |
| `border-neutral-200 dark:border-neutral-700` | `border-border` |
| `bg-black dark:bg-white` accent solids (send button) | `bg-accent text-accent-fg` |
| hardcoded `focus:ring-blue-500` etc. | `focus:ring-accent` |

Rules:
- **Drop redundant `dark:` pairs** once the token is in — `--color-border` flips
  itself under `[data-theme]` (`dark:border-neutral-700` next to `border-border` is dead weight).
- **Keep translucent overlays honest:** `bg-opacity-*` are Tailwind **v3-era
  utilities, removed in v4 — they are silent no-ops.** Use v4 slash alpha:
  `bg-surface/30`.
- **Never token-map** status reds/greens/blues/ambers or named color-button variants.
- If the file has component tests asserting literal class strings, update them in
  the same change.
- Keep the change palette-only: no behavioral edits in the same commit.

## 9. How to: rebuild the system from scratch

Batch order (each independently green-buildable):

1. **Foundation:** create `src/styles/` tree (`index.css`, `fonts/roles.css`,
   `themes/_contract.css`); move font `@theme` out of `src/index.css`; add
   `@import "./styles/index.css";` after the katex import; delete
   `tailwind.config.js`. Gate: pixel-identical render.
2. **Font runtime:** `fonts/options.css` catalog + `[data-font]` rebinds; bootstrap
   script writes `data-font`. Gate: console flip
   `document.documentElement.setAttribute('data-font','mono')` swaps fonts live.
3. **Theme runtime:** write theme files; re-key `@custom-variant dark` (§4.3);
   extend bootstrap to `data-theme` + `data-theme-scheme`. Gate: live theme swap +
   reload persistence + Onboarding still renders light under a dark theme.
4. **Select:** `ui/select.tsx` (§5).
5. **Settings:** `lib/appearance.ts` + Appearance section + probes +
   `handleResetToDefaults` integration.
6. **Sweep:** migrate consumers per §8.

## 10. Build & run pipeline (Windows)

```powershell
# UI bundle (emits app/ui/app/dist):
cd C:\Users\dnake\Allpaca\app\ui\app
npm run build            # runs: tsc -b && vite build

# Desktop app (production): Go embeds dist via //go:embed in app/ui/app.go:
cd C:\Users\dnake\Allpaca\app
go run ./cmd/app

# Desktop app (dev, hot reload): webview loads http://localhost:5173 instead of
# the embedded bundle — requires the Vite dev server already running:
#   terminal 1: cd app\ui\app ; npm run dev
#   terminal 2: cd app  ; go run ./cmd/app -dev
```

Gotchas:
- PowerShell 5.1 has **no `&&`** — use `;` or separate lines.
- The desktop app serves the **compiled bundle**; UI edits are invisible until
  `npm run build` (or use `-dev` mode).
- Single-instance lock: quit the Ollama tray instance first, else the new process
  focuses the old one and exits (`existing instance found, exiting`).
- Errors double-counted by `tsc -b` (two project builds) are one error each.

## 11. Debugging playbook

| Symptom | Likely cause | Fix / verify |
|---|---|---|
| Theme doesn't apply anywhere | `src/index.css` missing `@import "./styles/index.css";`, or theme file not imported in `styles/index.css` | DevTools → Elements: check `data-theme` on `<html>`; Styles pane: confirm `--color-*` overrides visible |
| Theme applies to nothing *except* the dropdown | Consumer components still use literal palette utilities | Continue §8 migration for that surface |
| Dropdown itself doesn't recolor | Vars not rebinding: `data-theme` attr missing/typo'd, or value not matching a `[data-theme="…"]` selector | Console: `document.documentElement.getAttribute('data-theme')`; check computed `--color-surface` on `<html>` |
| Reverts to default on reload | Bootstrap script missing, *after* the stylesheet link, or not writing `data-theme` | Read `index.html` `<head>`; verify `localStorage["allpaca:theme"]` is set; verify script precedes `<link rel="stylesheet">` |
| White flash on boot (FOUC) | Same as above; or someone moved the script below `<link>` | Bootstrap must be first paint, before CSS |
| Second flicker after load | React writing attributes at mount | Components must only `getTheme()/getFont()` at init; writes only from handlers |
| `dark:` variants dead | Variant still on `prefers-color-scheme`, or `data-theme-scheme` absent | Check `@custom-variant dark` (§4.3) and that bootstrap writes the scheme attr |
| Dark leaks onto Onboarding | `.light-only` exclusion removed from variant | Restore §4.3 verbatim |
| Swatches empty for some themes | Schema map mismatch: probe's `data-theme` didn't match a real theme selector, or theme missing from `THEME_OPTIONS`/`THEME_SCHEME` | Check the 4-place registry (§6) |
| Swatch chips look wrong in a new theme | `--color-accent`/`accent-fg` contrast, or values in `oklch()` (transpiled & frozen) | Re-do values in hex (§1) |
| `<html>` gets `data-font` but no visual change on Windows | Expected: `rounded` stack needs macOS/SF Pro; falls back to `system-ui` elsewhere | Ship a bundled font (§7) for cross-platform identity |
| TS2344 on `Listbox<T>` | Wrong generic slot | Remove the explicit generic (§5) |
| Opacity look wrong on overlays | `bg-opacity-*` no-ops in v4 | Slash alpha: `bg-surface/30` (§8) |
| Settings page lost its sidebar | Route not wrapped in the layout shell | Wrap route in `<SidebarLayout sidebar={<ChatSidebar />}>` (`routes/settings.tsx` pattern) |
| `Cannot find module '@/…'` build errors | File written against a different (newer/older) codebase | Validate every import against this repo's actual modules before shipping |

## 12. Known residuals (opt-in work)

- **Shiki syntax colors** (`StreamingMarkdownContent.tsx`): `one-light`/`one-dark`
  token colors are keyed to the *scheme* (twin `<pre>`s, `dark:hidden` /
  `hidden dark:block` — structural, keep them), not per-theme palette. Code stays
  readable in all themes; the syntax accents don't shift per theme.
- **Prose accents** (links, blockquotes, captions from the typography plugin)
  follow scheme, not palette. Deep fix = custom prose theme vars.
- **Upgrade shimmer gradient** (cyan/purple/green in `ui/display.tsx` consumers) is
  decorative brand, deliberately untouched.
- **FileUpload scrim** (`bg-neutral-500/5 dark:bg-neutral-400/10`) is intentionally
  literal — depth-cue family, theme-independent, same rationale as shadow tokens.

## 13. Never-do register

1. Never re-add `tailwind.config.js` (or anything calling `require()` in ESM).
2. Never rename the 8 tokens; extend `_contract.css` additively only.
3. Never edit only one leg of the 4-place registry (CSS file / styles import /
   `index.html` schemeMap / `appearance.ts` union + map + options).
4. Never let React write theme/font attributes at mount (read-only at boot).
5. Never place editing or authoring logic in the bootstrap script's webview block —
   that bottom `<script>` in `index.html` is load-bearing platform glue.
6. Never use `oklch()`/`color-mix()` in theme values (Safari-14 downlevel freezes them).
7. Never drop the `.light-only` exclusion from the `dark:` variant.
8. Never map status colors or named brand buttons onto tokens.

---

*Authored from the Allpaca theming implementation series (Batches 1–6 +
residual sweep). Verify file contents against disk before relying on line-level
assumptions — the tree is the source of truth.*
`````


