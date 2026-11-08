// File: docs/CHAT-FEATURES.md
# Chat, Projects, Archive & Delete — Deep Reference

**Audience:** an engineer who must rebuild, upgrade, refactor, or debug the chat sidebar and its data layer from scratch — with no prior context.

**Scope:** the desktop app's chat surfaces — conversations, projects (nested), archive, recently-deleted trash — plus the SQLite store, the HTTP routes, and the React frontend behind them. Model loading and inference are out of scope except where they touch persistence of chats/messages.

**How to use this document:**
- §1 **Invariants** — read first. These are the rules that break silently. They are not reconstructible from the code alone.
- §2 **Troubleshooting** — open this when something is wrong. Symptom → cause table + runbook.
- §3 **FAQ** — the questions a new engineer actually asks.
- §4 **The map** — processes, ports, env vars, file ownership, and the end-to-end call flows.
- §5 **Data model** — schema v1→v15, migrations, ownership of every column, every route, every query.
- §6 **Extending** — the copy-the-archive pattern, step by step, with the hard rules.
- §7 **Session scars** — real failures from this work and the rule each produced.
- §8 **Known issues / deferred** — do not rediscover as new bugs.

---

## Contents

1. [Invariants — read this first](#1-invariants--read-this-first)
2. [Troubleshooting — symptom → cause](#2-troubleshooting--symptom--cause)
3. [FAQ](#3-faq)
4. [The map — processes, ports, call flows](#4-the-map--processes-ports-call-flows)
5. [Data model — schema, ownership, queries, routes](#5-data-model--schema-ownership-queries-routes)
6. [How to extend — the archive-like feature pattern](#6-how-to-extend--the-archive-like-feature-pattern)
7. [Session scars — rules from real bugs](#7-session-scars--rules-from-real-bugs)
8. [Known issues / deferred work](#8-known-issues--deferred-work)

---

## 1. Invariants — read this first

Each rule below, if violated, produces **no compiler error and often no obvious runtime error**, and breaks a working feature. This is the highest-value section in the document.

### 1.1 `window.menu()` stages items; it does not render a menu

`window.menu(items)` is defined in `app/ui/app/index.html`. It does **not** create a popup. It stores the items in a module-level variable, stashes the returned promise's resolver, calls `window.setContextMenuItems(items)`, and returns a `Promise`. The menu is rendered **natively** by the WebView2 shell in response to `ICoreWebView2ContextMenuRequestedEventArgs`, which WebView2 raises only for **a trusted user gesture** — a real right-click on an element marked `allow-context-menu`.

Two consequences:

1. **Calling `window.menu()` from a left-click** stages the items and returns a promise **that never settles**, because no `ContextMenuRequested` event is ever going to fire. The UI looks dead — the click handler awaits a promise nobody resolves.
2. **Dispatching a synthetic `contextmenu` event** does not help. Untrusted events (created with `new MouseEvent(...)`) never reach the native `ContextMenuRequested` handler. The items are staged, no menu renders.

**This is why a React DOM menu exists.** `ChatActionsMenu.tsx` renders its own popup for the hover `⋯` trigger. Right-click / `onContextMenu` keeps the native path (which works). Both paths call the same action functions (`startEditing`, `handleArchiveToggle`, `handleDeleteChat`, `handleMoveToProject`), so behavior cannot drift.

**Do not "simplify" the DOM menu back to `window.menu()`.** It will go dead again.

Related: on macOS the native context-menu handler does not exist at all, so `window.menu()` never renders there either. The DOM menu works cross-platform; the native one does not.

### 1.2 Indexes on migration-added columns are created *after* `migrate()`

`init()` runs a fixed order:

1. `PRAGMA foreign_keys = ON`
2. `CREATE TABLE IF NOT EXISTS ...` (inline schema block)
3. `migrate()` — the version chain
4. **post-migrate index block**
5. `cleanupOrphanedData()`

On an **existing** database, `CREATE TABLE IF NOT EXISTS` is a **no-op** — the table exists, so the migration-added column (`project_id`, etc.) is **absent** at that point. Therefore any `CREATE INDEX ... ON <table>(<migration-added-column>)` placed in the inline schema block fails with `no such column`. That error aborts `init()`, so `migrate()` never runs, so the migration that would have added the column never runs — a hard deadlock at startup.

**Rule:** columns added by a migration → their index is created **post-migrate**, in the block after `migrate()` returns. `idx_chats_project_id` and `idx_projects_parent_id` are the live examples. `migrateV14ToV15` also creates them (so the upgraded-DB path is self-contained); the post-migrate block dedupes with `IF NOT EXISTS`.

```
init():
  CREATE TABLE IF NOT EXISTS ...   ← tables only, no indexes on new columns
  migrate()                        ← adds columns
  CREATE INDEX IF NOT EXISTS ...   ← post-migrate indexes (dedupe safe)
  cleanupOrphanedData()
```

### 1.3 `saveChat`'s UPSERT deliberately omits the ownership columns

`saveChat` writes exactly `id, title, created_at, browser_state`:

```sql
INSERT INTO chats (id, title, created_at, browser_state)
VALUES (?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    browser_state = COALESCE(excluded.browser_state, chats.browser_state)
```

It does **not** list `archived_at`, `deleted_at`, or `project_id`. Those are owned exclusively by their dedicated mutation methods:

| Column | Owner methods |
|---|---|
| `archived_at` | `archiveChat`, `unarchiveChat` |
| `deleted_at` | `softDeleteChat`, `restoreChat`, `purgeChat` (row removal) |
| `project_id` | `moveChatToProject` |

If you add any of these to the UPSERT column list, then every message write or rename (which calls `saveChat`) will **silently un-archive, un-trash, or unfile** a chat. That is a data-corruption bug with no error.

### 1.4 `getChatWithOptions` is unfiltered on purpose

`getChatWithOptions(id, loadAttachmentData)` selects a single row by ID with **no** filter on `deleted_at` or `archived_at`. This is deliberate:

- `chat()` (the streaming handler) loads the chat with `ChatWithOptions` before writing the user message. It then inspects `chat.DeletedAt != nil` / `chat.ArchivedAt != nil` to **auto-restore / auto-unarchive**.
- If you add `WHERE deleted_at IS NULL` here, a trashed chat becomes unloadable and auto-restore-on-reply dies permanently.

Trade-off: navigating directly to `/c/<deleted-id>` by URL still loads the conversation. That is acceptable for v1 and is what enables reply-triggered restore. It is an either/or, not a bug to fix.

### 1.5 Generated TS classes: never spread, always `new`

`ChatsResponse`, `ChatInfo`, `Chat`, `Model`, `Project`, `ProjectStats`, `Settings`, `ChatRequest` and the rest are produced by `tscriptify` into `app/ui/app/codegen/gotypes.gen.ts`. They are **classes**, not interfaces. They carry a `convertValues` method on the prototype.

Object spread (`{ ...old }`) copies own data properties but **drops the prototype**. So:

```ts
// WRONG — drops convertValues; latent cache corruption
queryClient.setQueryData<ChatsResponse>(["chats"], (old) => ({
  ...old,
  chatInfos: old.chatInfos.filter(...),
}));
```

- With an **explicit generic** (`setQueryData<ChatsResponse>`), this is a **hard type error**: `Property 'convertValues' is missing in type '{ chatInfos: ChatInfo[] }' but required in type 'ChatsResponse'`.
- Without the generic, it compiles and silently writes prototype-less objects into the react-query cache — a latent bug that only surfaces when someone later calls `convertValues`.

Correct:

```ts
queryClient.setQueryData<ChatsResponse>(["chats", "list", projectId ?? "root"], (old) => {
  if (!old?.chatInfos) return old;
  return new ChatsResponse({
    ...old,
    chatInfos: old.chatInfos.filter((chat) => chat.id !== chatId),
  });
});
```

The constructor takes a source bag and runs each field through `convertValues`, re-establishing the prototype. `new ChatsResponse({ ...old, chatInfos: [...] })` is safe; the `chatInfos` entries being plain objects are re-wrapped by the constructor.

This rule is currently honored in `useDeleteChat.ts` and `ChatSidebar.tsx` `saveRename`. Keep it that way.

### 1.6 Two timestamps, not one enum

`archived_at` and `deleted_at` are **independent nullable TIMESTAMP columns**, not `status = 'active' | 'archived' | 'deleted'`. Reasons:

1. **Trash UI and purge need the date.** "Deleted 3 days ago" and `WHERE deleted_at < now - 30 days` require a timestamp a boolean cannot hold.
2. **Archive survives a delete/restore round trip for free.** Delete an archived chat → `deleted_at = now`, `archived_at` untouched. Restore → `deleted_at = NULL`, and because `archived_at` was never cleared, the chat returns to the **archive**, not the active list. An enum would need a `previous_status` column to reproduce this.
3. **Every transition is one `UPDATE`.** No state machine, no impossible states.

`NULL` = not in that state. Both can be set at once (archived + deleted) — that is intended and is exactly the round-trip case above.

### 1.7 `DeleteChat` is soft; only `PurgeChat` destroys

- **`DeleteChat`** → `UPDATE chats SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL`. Row and messages survive; the chat moves to Recently Deleted for 30 days.
- **`PurgeChat`** → `DELETE FROM chats WHERE id = ?` (cascades `messages`, `tool_calls`, `attachments` via `ON DELETE CASCADE`) **and** removes the image dir `filepath.Join(Store.ImgDir(), id)` via `os.RemoveAll`.

**Project deletion can never cascade into chat loss.** `deleteProject(id, mode)` runs in one transaction:

- `mode="promote"` (default): `UPDATE chats SET project_id = NULL WHERE project_id IN (subtree)` then `DELETE FROM projects WHERE id IN (subtree)`. Chats fall back to Unfiled, untouched.
- `mode="delete"`: `UPDATE chats SET deleted_at = CURRENT_TIMESTAMP WHERE project_id IN (subtree) AND deleted_at IS NULL` then delete the projects. Chats move to the 30-day trash. Still recoverable.

In both cases the chat rows outlive the project rows. Structural operations never destroy conversations; the worst case is a chat moving to Unfiled or to the trash.

**`deleteChat` is idempotent.** The handler checks `chat.DeletedAt != nil` and returns 200 without calling the store — so a second delete of an already-trashed chat does not reset the 30-day timer. The store method itself uses `WHERE ... AND deleted_at IS NULL` and treats 0-rows-with-existing-row as success.

### 1.8 `go generate ./app/ui/...` is mandatory after any `responses/types.go` change

`gotypes.gen.ts` is generated from `responses/types.go` by `tscriptify` and is **checked in**. Change a Go struct without regenerating and the frontend `tsc -b` fails on the missing member(s):

- Adding `DeletedAt` to `ChatInfo` → `Property 'deletedAt' does not exist on type 'ChatInfo'`
- Adding `Project` / `ProjectsResponse` / `ProjectStats` → `Module has no exported member 'Project'`
- Adding `projectId` to `ChatRequest` → `Property 'projectId' does not exist`

`go generate` is **not** on the command allowlist — it is a manual terminal step. The two directives at the top of `app/ui/ui.go`:

```
//go:generate tscriptify -package=github.com/topseeder1/allpaca/app/ui/responses -target=./app/codegen/gotypes.gen.ts responses/types.go
//go:generate npm --prefix ./app/ui/app run build
```

So `go generate ./app/ui/...` rebuilds the types **and** the frontend. If `tscriptify` is missing: `go install github.com/tkrajina/typescriptify-golang-structs/tscriptify@latest` and ensure `$(go env GOPATH)/bin` is on `PATH`.

Do not hand-edit `gotypes.gen.ts`; it is overwritten on the next generate.

### 1.9 Query keys: `["chats", "list", projectId ?? "root"]`, `["chats", "archived"]`, `["chats", "deleted"]`

All chat-list caches live under the `["chats"]` prefix:

| Key | Source | Fetch |
|---|---|---|
| `["chats", "list", projectId ?? "root"]` | `useChats(projectId?)` | `GET /api/v1/chats?project=<id>` (or no param) |
| `["chats", "archived"]` | `useArchivedChats()` | `GET /api/v1/chats/archived` |
| `["chats", "deleted"]` | `useDeletedChats()` | `GET /api/v1/chats/deleted` |

`invalidateQueries({ queryKey: ["chats"] })` matches **by prefix**, so one call refreshes all of them. That is the invalidation path used by every mutation (archive, trash, restore, purge, move, project delete).

**But `setQueryData` matches exactly, not by prefix.** Writing optimistic data to `["chats"]` writes to a query nobody subscribes to. This is the root of the current delete-delay bug (§8.1): the optimistic row removal is a visual no-op; the real delete still happens after the 6 s timer and the refetch cleans up.

### 1.10 `chat()` auto-unarchive/restore is gated on `!req.ForceUpdate`

Sending a message into an archived or trashed chat restores it. The restore block lives **inside** `if !req.ForceUpdate { ... }` in `ui.go`'s `chat()`:

```go
if chat.ArchivedAt != nil { s.Store.UnarchiveChat(cid); chat.ArchivedAt = nil }
if chat.DeletedAt != nil  { s.Store.RestoreChat(cid);   chat.DeletedAt = nil }
```

`ForceUpdate` is a model-refresh path (download/refresh a model's metadata), not a user reply. It must not trigger restore. If you move this block out of the `!req.ForceUpdate` guard, model refreshes will resurrect trashed chats.

### 1.11 Dialogs are DOM modals — never `window.confirm` / `window.prompt`

WebView2 can be configured with `CoreWebView2Settings.AreDefaultScriptDialogsEnabled = false`. When it is:

- `window.confirm()` returns `false` **without showing anything**.
- `window.prompt()` returns `null` **without showing anything**.

Any handler that does `const ok = window.confirm(...); if (!ok) return;` becomes a **silent no-op** — the button appears dead. This exact class of bug was observed earlier in the delete flow.

**Rule:** every confirmation is a React modal or an inline two-step confirm:

- `NewProjectDialog` — name input modal (used for new project, new subproject, rename).
- `DeleteProjectDialog` — two explicit choices (promote vs delete).
- Delete-forever button — inline: first click arms `Confirm?` for 4 s; second click within the window commits.
- The chat delete uses a non-blocking **undo toast** (6 s), not a confirm dialog at all.

### 1.12 Sidebar sections always render; empty state is a muted line

`ChatSidebar.tsx` renders `Projects`, `Chats`, `Archived`, and `Recently Deleted` **unconditionally**. Empty sections show a muted one-liner ("No archived conversations", "No deleted conversations", "No projects yet"). They are **not** conditionally mounted on `length > 0`.

Consequence for debugging: "I don't see the section" almost always means the section is **off-screen**, not absent. The sidebar stacks four panels: `Chats` is `flex-1` and scrolls internally; `Archived` and `Recently Deleted` are `max-h-40` widgets pinned below. On a short window the `Chats` panel can eat the viewport and push the capped panels below the fold. Scroll or resize before assuming a code bug.

### 1.13 The `projectId` on a new chat is a "first message" hint, not a mover

`ChatRequest.projectId` (added to `responses/types.go`) associates a **newly created** chat with a project **on its first message, only when the chat is currently unfiled** (`chat.ProjectID == nil`). It never moves an existing chat. Moving an existing chat out of a project is `PUT /api/v1/chat/{id}/project` (via `⋯` → Move to project), which is an explicit user action.

### 1.14 The project tree is flat in the DB, nested in the UI

`projects.parent_id` is self-referential (unlimited depth). The frontend fetches a **flat list** (`GET /api/v1/projects`) and assembles the tree client-side: `ProjectsPanel` shows only top-level rows (`!parentId`); the breadcrumb walks `parentId` up a guard set; child-project chips filter `projects.filter(p => p.parentId === selectedProjectId)`. No recursive SQL in the list path — only `getProjectSubtree` uses a recursive CTE, and only in the delete path.

### 1.15 Native right-click "Move to project" is a heuristic

The native shell menu has no submenus. `handleContextMenu` handles "Move to project" by **opening the DOM submenu** at a heuristic center position (`window.innerHeight/2`, `window.innerWidth/2`). It is functional but the popup is not anchored to the row. The `⋯` path anchors correctly. This is documented as a known issue (§8.4), not a bug to "fix" by removing the native entry.

---

## 2. Troubleshooting — symptom → cause

The table is arranged roughly by frequency. Below it is the launch/verify/restart runbook.

| Symptom | Likely cause | Fix |
|---|---|---|
| **New routes return 404** — `/api/v1/projects`, `/chats/archived`, `/chats/deleted` | The running Go process is **older than the code**. On Windows, `go run` spawns a child that survives a closed terminal, so a window close does not kill it. | `taskkill /IM allpaca.exe /F` and `taskkill /IM go.exe /F` (ignore "not found"), then relaunch. Verify with `http://127.0.0.1:3001/api/v1/projects` → must be JSON, not 404. |
| **`no such column: project_id`** on `initialize database` | An index on a migration-added column was placed in the inline schema block. `CREATE TABLE IF NOT EXISTS` is a no-op on an existing DB, so the column doesn't exist when the index runs; `init()` aborts before `migrate()`. | Move the index to the post-migrate block in `init()` (§1.2). Migration never ran, so the DB is still at the old version — no partial state to repair. |
| **`Vite dev server not running on port 5173`**, app exits immediately | `--dev` dials 5173 on startup and `os.Exit(1)` if it is not up. | Terminal 1: `npm run dev` in `app/ui/app`, wait for `Local: http://127.0.0.1:5173`, **then** Terminal 2: `go run ./app/cmd/app --dev`. |
| **`ERR_CONNECTION_REFUSED` on `127.0.0.1`** | Nothing is listening — the Go process already exited (usually because Vite wasn't up). | Not a firewall/proxy/cloud issue. Check Terminal 2 for the real error first. |
| **Blank window in the production exe** | `dist/` not rebuilt before `go build`. The exe embeds `dist/` at build time via `embed.FS`. | `npm run build` in `app/ui/app`, then `go build -o allpaca.exe ./app/cmd/app`, relaunch. `Ctrl+R` will not pick up a new `dist/`. |
| **`tsc` errors: missing `deletedAt` / `projectId` / `archivedAt` / `Project`** | Stale codegen. Go structs changed, `gotypes.gen.ts` did not. | `go generate ./app/ui/...` (manual; not allowlisted). See §1.8. |
| **`useChats has no exported member X`** — many hooks missing at once | `useChats.ts` was overwritten by a partial emission. That file has 13 exports and `useSendMessage` is the streaming engine. | Restore from upstream (§7). Never partial-emit this file. |
| **`Archived`/`Recently Deleted` not visible at all** | Usually the window is too short: `Chats` is `flex-1` and pushes the capped panels below the fold. Occasionally stale HMR. | Scroll the sidebar / resize. If genuinely absent, `Ctrl+Shift+R` (hard reload); on the exe, rebuild (§ blank window). Both sections render unconditionally in `ChatSidebar.tsx` (§1.12). |
| **A freshly deleted chat is not in Recently Deleted** | Either the delete happened under a pre-soft-delete binary (those were **hard**-deleted — gone forever), or the delete mutation is failing and the error is swallowed. | Check `http://127.0.0.1:3001/api/v1/chats/deleted`. JSON containing the chat → backend fine, frontend issue. Empty `[]` after a fresh delete → delete failing; open DevTools console for `Failed to delete chat`. |
| **Delete removes the row only after ~6 s, not instantly** | Known issue (§8.1): `useDeleteChat` writes optimistic data to `["chats"]`, but the list reads `["chats","list",projectId]` (§1.9). | Server-side delete works; it's a visual-only delay. Fix deferred. |
| **`window.confirm`/`prompt` never fires; button appears dead** | WebView2 suppressed script dialogs. | Use a DOM modal or inline confirm (§1.11). |
| **A rename or chat save un-archived / un-trashed / unfiled a chat** | Someone added an ownership column to `saveChat`'s UPSERT. | Remove it from the column list (§1.3). |
| **A project delete wiped chats you wanted kept** | Should be impossible via `mode=promote` (it only nulls `project_id`). Check which `mode` the dialog sent — `mode=delete` deliberately soft-deletes the chats into the trash. | Chats are recoverable from Recently Deleted (30 days). Inspect the `DELETE /api/v1/project/{id}?mode=` call. |
| **`project_id` exists but projects panel is empty** | No projects created yet. `{"projects":[]}` is valid. | Create one via the `+` in the Projects header. Existing chats all get `project_id = NULL` = Unfiled. |
| **Move-to-project submenu shows a flat picker that doesn't nest visually** | It **is** nested — indented by `depth * 12px`, tree-walked from the flat list. It's a flat list with left padding, not an expandable tree. | Working as designed. The picker is a flat indented list for simplicity. |

### Runbook — launch, verify, restart

**Dev mode (frontend hot reload):**
1. Terminal 1: `cd app/ui/app && npm run dev` → wait for `Local: http://127.0.0.1:5173`.
2. Terminal 2: `go run ./app/cmd/app --dev`.
3. Verify the fresh server before touching the UI:
   - `http://127.0.0.1:3001/api/v1/projects` → `{"projects":[]}`
   - `http://127.0.0.1:3001/api/v1/chats/archived` → `{"chatInfos":[]}`
   - `http://127.0.0.1:3001/api/v1/chats/deleted` → `{"chatInfos":[]}`

Dev UI is a fixed `127.0.0.1:3001`; Vite on 5173; `OLLAMA_CORS=1` is set by `--dev`. Go changes do **not** hot-reload — restart Terminal 2 only. Frontend `.tsx`/`.ts`/`.css` changes hot-reload via Vite.

**Production:**
1. `npm run build` in `app/ui/app` → writes `dist/`, embedded by `app/ui`.
2. `go build -o allpaca.exe ./app/cmd/app`.
3. Run. UI on `127.0.0.1:52342` (stable origin so localStorage/theme persists), inference on 11435.

**Hard restart:** Ctrl-C both terminals → `taskkill /IM allpaca.exe /F` + `taskkill /IM go.exe /F` (ignore "not found") → start Vite → start app.

**Build checks:**
- `go build ./app/store/ ./app/ui/ ./app/cmd/app` — silent = pass.
- `go test ./app/store/` — exercises migrations + soft-delete + projects + purge.
- `npm run build` in `app/ui/app` — `tsc -b && vite build`; `tsc -b` runs first, so a TS error prevents `vite build`.

**First launch after a schema bump** runs the migration chain silently inside `ensureDB()` on the first chat-list load. The `projects` table + `chats.project_id` are created (v15). Every existing chat gets `project_id = NULL` (= Unfiled). Metadata-only — instant in SQLite.

---

## 3. FAQ

**Where is chat data stored — files or a database?**
SQLite. One `db.sqlite` file (`%LOCALAPPDATA%\Allpaca\db.sqlite` on Windows; `~/Library/Application Support/Allpaca/db.sqlite` on macOS; `~/.allpaca/db.sqlite` otherwise). A conversation is up to four related tables:

- `chats` — id, title, created_at, archived_at, deleted_at, project_id, browser_state
- `messages` — role, content, thinking, model, timing, tool_result, FK → chats ON DELETE CASCADE
- `tool_calls` — function name/args/result, FK → messages ON DELETE CASCADE
- `attachments` — filename + `data BLOB NOT NULL`, FK → messages ON DELETE CASCADE

Plus an on-disk **image directory** keyed by chat id: `Store.ImgDir()` = `<db-dir>/cache/images`, with a per-chat subdir created by `ImgToFile`. There is no per-chat JSON file. `DeleteChat` (soft) does not touch files; `PurgeChat` (hard) removes the row **and** the image dir.

**How long do deleted chats live?**
30 days. Purge runs **once per `Store` lifetime**, on startup (`ensureDB()` via `sync.Once`) — not a live timer. So an expired chat can linger past 30 days if the app stays open; it is gone on the next launch. Within 30 days it is in Recently Deleted and restorable.

**Does replying to a trashed / archived chat bring it back?**
Yes. Sending a message auto-unarchives and auto-restores (gated on `!req.ForceUpdate`, §1.10). This is why `getChatWithOptions` is unfiltered (§1.4).

**Can I delete a project without losing its conversations?**
Yes. `deleteProject(id, mode)` removes the project subtree and asks where the chats go: **promote** (default — chats move to Unfiled, untouched) or **delete** (chats move to Recently Deleted for 30 days). Neither path hard-destroys a chat.

**Do subprojects nest arbitrarily deep?**
Yes. `projects.parent_id` is self-referential, unlimited depth. The sidebar shows top-level projects in the Projects panel; drilling into one shows a breadcrumb and child-project chips. There is no hardcoded depth limit.

**What happens when I create a chat while inside a project?**
Backend supports it: `ChatRequest.projectId` associates a **new** chat on its first message when the chat is unfiled (it never moves an existing chat). The frontend `useSendMessage` call site does **not** currently thread `projectId` through `/c/new` (§8.3) — for now, create the chat and use `⋯` → Move to project.

**Why two terminals in dev?**
Vite (5173) serves hot-reloading UI; the Go process serves the API and runs inference, and spawns the webview against Vite. `--dev` dials 5173 on startup and exits if it is not up. Production embeds `dist/` and needs no Vite.

**Where do models live?**
`ALLPACA_MODELS` is checked first, `OLLAMA_MODELS` is the fallback (multi-root resolver in `manifest/manifest.go`; see `envconfig.AllpacaModels()`). Layout is identical in both: `manifests/.../<tag>` + `blobs/sha256-*`. Models report an `origin` (`"allpaca"` / `"ollama"`) and the UI badges it. The default server port is **11435**, not 11434.

**How do I add a new section to the sidebar?**
Use `CollapsibleSection` (§6). Sections always render; empty ones show a muted one-liner. The layout gives each panel its own scrollbar: `Chats` is `flex-1` and scrolls; secondary panels are `max-h-40` and scroll.

**What is the "archive-like feature pattern"?**
Adding another list view backed by a nullable timestamp ("pinned", "snoozed", …) is a copy of the archive pattern: schema column + owner methods + filtered query reusing `queryChats` + one route + a `ChatInfo` field + codegen + a hook + a `CollapsibleSection`. See §6.

**Why did `window.confirm` do nothing?**
WebView2 suppressed script dialogs (§1.11). All confirmations are DOM-based.

**Where is the native right-click menu defined?**
`window.menu` in `app/ui/app/index.html` stages; the native popup is `ICoreWebView2ContextMenuRequestedEventArgs` in the C++ glue (`app/webview/`). It is Windows-only and requires a trusted gesture (§1.1).

**How do I prove which backend is live?**
Hit `http://127.0.0.1:3001/api/v1/projects` while the dev app runs. JSON = fresh; 404 = stale process. Same for `/chats/archived` and `/chats/deleted`. That is the single fastest diagnostic.

---

## 4. The map — processes, ports, call flows

### 4.1 Processes and ports

| Process | Port | Notes |
|---|---|---|
| Inference server | **11435** default (`envconfig.Host()`) | Desktop spawns it with `OLLAMA_HOST=0.0.0.0`; port from default/`OLLAMA_PORT`. |
| UI server (dev) | **3001** fixed | `app/cmd/app/app.go` `--dev`; requires Vite already up; sets `OLLAMA_CORS=1`; skips token cookie (`ui.Server{Dev: true}`). |
| UI server (prod) | **52342** | Stable origin so localStorage/theme persists across launches. |
| Vite dev server | **5173** | Must run before the Go app starts in dev. Serves HMR over `127.0.0.1:5173`. |

### 4.2 Relevant environment variables

- `OLLAMA_MODELS`, `ALLPACA_MODELS` — model roots (Allpaca wins on collision; both checked by the multi-root manifest resolver).
- `OLLAMA_REMOTES` — remote host allowlist, default `"ollama.com"`.
- `OLLAMA_DOT_COM_URL` — override the cloud base URL.
- `OLLAMA_CORS` — set to `1` in dev mode by `--dev`.

### 4.3 File ownership map

| Concern | Location |
|---|---|
| Schema, migrations, chat queries, projects & soft-delete store layer | `app/store/database.go` |
| Public store API (what handlers call) | `app/store/store.go` |
| Chat image dir + per-chat image storage | `app/store/image.go` (`Store.ImgDir()`, `ImgToFile`) |
| HTTP routes + handlers, chat streaming | `app/ui/ui.go` |
| JSON shapes for routes (incl. `ChatInfo`, `Project`, `ProjectsResponse`, `ProjectStats`) | `app/ui/responses/types.go` |
| Generated TS types | `app/ui/app/codegen/gotypes.gen.ts` (via `go generate`) |
| Fetch helpers | `app/ui/app/src/api.ts` |
| Chat list / streaming hooks (13 exports) | `app/ui/app/src/hooks/useChats.ts` |
| Project CRUD hooks | `app/ui/app/src/hooks/useProjects.ts` |
| Archive / trash / deferred-delete hooks | `hooks/useArchivedChats.ts`, `useDeletedChats.ts`, `useArchiveChat.ts`, `useDeleteChat.ts` |
| Sidebar (all sections + filter state) | `components/ChatSidebar.tsx` |
| Row action menu (DOM, Move-to-project submenu) | `components/ChatActionsMenu.tsx` |
| Projects panel / breadcrumb / dialogs | `components/ProjectsPanel.tsx`, `ProjectBreadcrumb.tsx`, `NewProjectDialog.tsx`, `DeleteProjectDialog.tsx` |
| Section shell | `components/CollapsibleSection.tsx` |
| Undo toast | `components/UndoToast.tsx` |
| Dev-mode launch + Vite precondition | `app/cmd/app/app.go` |
| Port default / models / remotes env | `envconfig/config.go` |

### 4.4 End-to-end call flows

**List chats (root or a project):**
```
ChatSidebar useChats(selectedProjectId)
  → react-query key ["chats","list", projectId ?? "root"]
  → GET /api/v1/chats?project=<id>   (or no param)
  → ui.go listChats
      → Store.Chats()            (project == "")
      → Store.ChatsInProject(id) (project != "")
  → database.queryChats(where, orderBy, args...)
      WHERE archived_at IS NULL AND deleted_at IS NULL [AND project_id = ? | IS NULL]
  → []store.Chat → chatInfoFromChat → responses.ChatsResponse{chatInfos}
```

**Archive a chat:**
```
⋯ → ChatActionsMenu "Archive"  OR  right-click native "Archive"
  → useArchiveChat.mutate({chatId, archive:true})
  → POST /api/v1/chat/{id}/archive
  → ui.go archiveChat → Store.ArchiveChat → database.archiveChat
      UPDATE chats SET archived_at = CURRENT_TIMESTAMP WHERE id = ?
  → onSuccess: invalidateQueries(["chats"])   ← prefix hits list/archived/deleted
```

**Delete a chat (soft, deferred, undoable):**
```
⋯ → Delete
  → useDeleteChat.schedule(chatId, title)
      1. optimistic remove (writes ["chats"] — BUG, see §8.1)
      2. push to `pending` (renders UndoToast)
      3. setTimeout(6000) → mutate(chatId)
  → DELETE /api/v1/chat/{id}
  → ui.go deleteChat
      → ChatWithOptions(cid)  → if DeletedAt != nil return 200 (idempotent)
      → Store.DeleteChat → database.softDeleteChat
          UPDATE chats SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL
  → onSuccess: invalidateQueries(["chats"])
Undo (within 6 s): clearTimeout, drop pending, invalidateQueries(["chats"]) — chat still exists server-side
```

**Restore from trash:** `Recently Deleted` → Restore → `POST /api/v1/chat/{id}/restore` → `restoreChat` → `UPDATE chats SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL` (preserves `archived_at`).

**Delete forever:** two-step inline confirm → `DELETE /api/v1/chat/{id}/purge` → `PurgeChat` → `DELETE FROM chats WHERE id = ?` (cascade) + `os.RemoveAll(ImgDir()/<id>)`.

**Create a project / subproject:** `+` or breadcrumb `+ Subproject` → `NewProjectDialog` → `useCreateProject.mutate({name, parentId})` → `POST /api/v1/projects` → `createProject` (validates parent exists if given) → invalidate `["projects"]`.

**Delete a project:** `ProjectsPanel ⋯ → Delete project` → `DeleteProjectDialog` (fetches `GET /api/v1/project/{id}/stats`) → choose **promote** or **delete** → `DELETE /api/v1/project/{id}?mode=<mode>` → `deleteProject` (recursive-CTE subtree, one tx) → invalidate `["projects"]` + `["chats"]`.

**Move a chat to a project:** `⋯ → Move to project ›` → pick project or Unfiled → `useMoveChatToProject.mutate({chatId, projectId})` → `PUT /api/v1/chat/{id}/project` → `moveChatToProject` → `UPDATE chats SET project_id = ?` (or NULL) → invalidate `["projects"]` + `["chats"]`.

**Reply to an archived/trashed chat:** `sendMessage` → `POST /api/v1/chat/{id}` → `chat()` → load chat (unfiltered) → if `!req.ForceUpdate` and `ArchivedAt`/`DeletedAt` set → `UnarchiveChat`/`RestoreChat`, clear the field in memory, then proceed with the normal streaming write path.

---

## 5. Data model — schema, ownership, queries, routes

### 5.1 Schema versioning

`currentSchemaVersion = 15` in `app/store/database.go`. `migrate()` reads `settings.schema_version` and loops the version chain. Each step is idempotent and guarded (`duplicateColumnError` for `ADD COLUMN`, `columnNotExists` for `DROP COLUMN`). A fresh DB runs `CREATE TABLE IF NOT EXISTS` with the full current schema, then `migrate()` is a no-op (version already at 15), then the post-migrate indexes dedupe.

### 5.2 Version changelog

| Version | Change | Owner / note |
|---|---|---|
| v1 | Base schema (`settings`, `chats`, `messages`, `tool_calls`, `users`) | original |
| v2 | `settings.context_length`, `settings.survey` | settings |
| v3 | `attachments` table | attachments |
| v4 | `messages.tool_result` | tool results |
| v5 | `settings.airplane_mode` | settings |
| v6 | `settings.turbo_enabled`, `websearch_enabled`, `selected_model`, `sidebar_open` | settings |
| v7 | `idx_attachments_message_id` | index |
| v8 | `settings.think_enabled`, `think_level` | settings |
| v9 | `chats.browser_state` | browser tool state |
| v10 | `users` table cache | user profile |
| v11 | drop `settings.remote` | settings |
| v12 | re-add `settings.remote` (deprecated) | settings |
| v13 | `chats.archived_at TIMESTAMP` | `archiveChat` / `unarchiveChat`; **excluded from `saveChat`** |
| v14 | `chats.deleted_at TIMESTAMP` | `softDeleteChat` / `restoreChat` / `purgeChat`; **excluded from `saveChat`** |
| v15 | `projects` table (self-referential `parent_id` → `projects.id ON DELETE SET NULL`) + `chats.project_id TEXT` (no FK) + indexes | `createProject` / `renameProject` / `deleteProject` / `moveChatToProject`; **`project_id` excluded from `saveChat`** |

Fresh-DB `CREATE TABLE` includes all of the above; upgraded DBs get them via `migrate()`.

### 5.3 Ownership of every column

| Table.column | Written by | Read by |
|---|---|---|
| `chats.id`, `title`, `created_at`, `browser_state` | `saveChat` | `queryChats`, `getChatWithOptions` |
| `chats.archived_at` | `archiveChat` (set), `unarchiveChat` (clear) | `queryChats` filter, `chatInfoFromChat` |
| `chats.deleted_at` | `softDeleteChat` (set), `restoreChat` (clear); row removed by `purgeChat` | `queryChats` filter, `chatInfoFromChat`, `purgeExpiredChats` |
| `chats.project_id` | `moveChatToProject`, `chat()` first-message hint | `queryChats` filter, `chatInfoFromChat` |
| `projects.id`, `name`, `parent_id`, `created_at`, `sort_order` | `createProject`, `renameProject`, `deleteProject` | `getProjects`, `getProjectByID`, `getProjectSubtree` |
| `settings.*` | `setSettings` and individual setters | various |

**No write path except the listed owner touches an ownership column.** That is the invariant (§1.3).

### 5.4 List queries — single source

Every chat-list projection goes through one function:

```go
func (db *database) queryChats(where, orderBy string, args ...any) ([]Chat, error)
```

`where` and `orderBy` are compile-time constants supplied by the caller. `args` bind to `?` placeholders (used only by the project filter). The callers:

| Caller | `where` | `orderBy` |
|---|---|---|
| `getAllChats` (root/unfiled) | `c.archived_at IS NULL AND c.deleted_at IS NULL AND c.project_id IS NULL` | `last_updated DESC` |
| `getProjectChats(pid)` | `c.archived_at IS NULL AND c.deleted_at IS NULL AND c.project_id = ?` (+ `pid`) | `last_updated DESC` |
| `getArchivedChats` | `c.archived_at IS NOT NULL AND c.deleted_at IS NULL` | `c.archived_at DESC` |
| `getDeletedChats` | `c.deleted_at IS NOT NULL` | `c.deleted_at DESC` |

The projection computes `first_msg.content` (the first user message excerpt) via a `MIN(id)` grouped subquery and `last_updated` via `MAX(m.updated_at)` falling back to `c.created_at`. It returns `Chat` values with one synthetic `Message` (the excerpt) so `chatInfoFromChat` can populate `UserExcerpt`/`UpdatedAt` without loading full message rows.

### 5.5 Semantics

- `NULL` timestamp = not in that state. Both `archived_at` and `deleted_at` can be set at once (archived + deleted). Restore preserves `archived_at` — deleted-from-archive returns to the archive.
- **Project delete** (`deleteProject(id, mode)` in one transaction): `mode="promote"` → `UPDATE chats SET project_id = NULL`; `mode="delete"` → `UPDATE chats SET deleted_at = CURRENT_TIMESTAMP WHERE deleted_at IS NULL`; then `DELETE FROM projects WHERE id IN (subtree)`. Chats always outlive project rows.
- **Purge on startup**: `purgeExpiredChats(30 * 24 * time.Hour)` deletes rows whose `deleted_at < now - 30 days` and removes each chat's image dir (`filepath.Join(Store.ImgDir(), id)` + `os.RemoveAll`).
- **Image dir**: `Store.ImgDir()` returns `<db-dir>/cache/images`; `ImgToFile` writes a per-chat subdirectory inside it. Soft delete does not touch it; purge removes it.

### 5.6 Routes (registered in `ui.go` `Handler()`)

| Method + path | Handler | Behavior |
|---|---|---|
| `GET /api/v1/chats?project=<id>` | `listChats` | unfiled (no param) or one project's list |
| `GET /api/v1/chats/archived` | `listArchivedChats` | archived, not deleted |
| `GET /api/v1/chats/deleted` | `listDeletedChats` | trashed, within 30 days |
| `GET /api/v1/chat/{id}` | `getChat` | full chat, unfiltered (deliberate §1.4) |
| `POST /api/v1/chat/{id}` | `chat` | streams response; auto-restore/unarchive on reply; accepts `projectId` on first message |
| `POST /api/v1/create-chat` | `createChat` | generates a new chat id |
| `DELETE /api/v1/chat/{id}` | `deleteChat` | soft delete, idempotent (200 no-op if already trashed) |
| `PUT /api/v1/chat/{id}/rename` | `renameChat` | title only |
| `POST /api/v1/chat/{id}/archive` | `archiveChat` | set `archived_at` |
| `POST /api/v1/chat/{id}/unarchive` | `unarchiveChat` | clear `archived_at` |
| `POST /api/v1/chat/{id}/restore` | `restoreChat` | clear `deleted_at` (preserves `archived_at`) |
| `DELETE /api/v1/chat/{id}/purge` | `purgeChat` | permanent delete + image cleanup |
| `PUT /api/v1/chat/{id}/project` | `moveChatToProject` | body `{"projectId": <id|null>}` |
| `GET /api/v1/projects` | `listProjects` | flat list with direct chat counts |
| `POST /api/v1/projects` | `createProjectHandler` | body `{"name", "parentId"?}` |
| `PUT /api/v1/project/{id}` | `renameProjectHandler` | body `{"name"}` |
| `DELETE /api/v1/project/{id}?mode=promote\|delete` | `deleteProjectHandler` | subtree delete in one tx |
| `GET /api/v1/project/{id}/stats` | `projectStatsHandler` | `{chatCount, subprojectCount}` for the dialog |

`ChatRequest.projectId` (JSON `projectId`) associates a **new** chat on its first message when the chat is unfiled; it never moves an existing chat.

### 5.7 The `ChatInfo` response and codegen

`chatInfoFromChat(store.Chat)` → `responses.ChatInfo`:

```go
type ChatInfo struct {
    ID          string     `json:"id"`
    Title       string     `json:"title"`
    UserExcerpt string     `json:"userExcerpt"`
    CreatedAt   time.Time  `json:"createdAt"  ts_type:"Date" ...`
    UpdatedAt   time.Time  `json:"updatedAt"  ts_type:"Date" ...`
    ArchivedAt  *time.Time `json:"archivedAt,omitempty" ...`
    DeletedAt   *time.Time `json:"deletedAt,omitempty"  ...`
    ProjectID   *string    `json:"projectId,omitempty"`
}
```

The `tscriptify` tags convert `time.Time` → `Date` in the generated TS and, for pointers, `__VALUE__ && new Date(__VALUE__)`. Changing this struct requires `go generate` (§1.8) and the sidebar relies on `deletedAt` for the "Deleted N days ago" label.

---

## 6. How to extend — the archive-like feature pattern

Adding another list view backed by a nullable timestamp ("pinned", "snoozed", "flagged", …) is a **copy of the archive pattern**. Five seams, in order:

### 6.1 Schema (one migration)

1. Add a `migrateV<n-1>ToV<n>()` that runs `ALTER TABLE chats ADD COLUMN <x>_at TIMESTAMP` (guarded by `duplicateColumnError`) and bumps `settings.schema_version`.
2. Add the column to the fresh-DB `CREATE TABLE chats` block so fresh installs get it without the migration path.
3. Increment `currentSchemaVersion` and add the `case <n-1>:` branch in `migrate()`.
4. If you index the new column, create the index **post-migrate** (§1.2) — never in the inline schema block.
5. **Do not** add the column to `saveChat`'s UPSERT column list (§1.3). It is owned by its dedicated mutation methods.

### 6.2 Store (database.go + store.go)

- `database.go`: the mutation methods (`pinChat`, `unpinChat`, …) each a single `UPDATE`; a filtered query that reuses `queryChats("<where>", "<orderBy>")`.
- `store.go`: public wrappers (`Store.PinChat`, `Store.UnpinChat`, `Store.PinnedChats`) that call `ensureDB()` then the `database` method.

### 6.3 Routes (ui.go)

- Register in `Handler()`: e.g. `POST /api/v1/chat/{id}/pin`, `POST /api/v1/chat/{id}/unpin`, `GET /api/v1/chats/pinned`.
- Handler pattern: read `PathValue("id")`, call the store, map `not.Found` → 404, else 200. For a list, map `[]store.Chat` → `responses.ChatInfo` via `chatInfoFromChat` and encode `responses.ChatsResponse`.

### 6.4 Response type + codegen

- Add the field to `ChatInfo` in `responses/types.go` (with the same `ts_type`/`ts_transform` tags if it is a `*time.Time`).
- Run `go generate ./app/ui/...` (manual; not allowlisted). Do not hand-edit `gotypes.gen.ts`.

### 6.5 Frontend (api.ts + hook + section)

- `api.ts`: a fetch helper with a `response.ok` check (never assume `[]` on a 404 — that is what made one bug invisible for turns). A `POST` helper for the mutation.
- A hook under `hooks/`: `usePinnedChats()` (`queryKey: ["chats", "pinned"]`) and a mutation hook that invalidates `["chats"]` (prefix hits list + archived + deleted + pinned).
- `ChatSidebar.tsx`: add a `<CollapsibleSection title="Pinned" ...>` — **always rendered**, empty state a muted line (§1.12), bounded height (`max-h-40` + internal scroll) so it does not push the list.

### 6.6 Hard rules for every new surface

- **One handler, multiple triggers.** The `⋯` menu and right-click must call the same function. The `⋯` path opens the DOM menu (§1.1); right-click uses the native menu.
- **Never render an action with no backend behind it.** A menu item that no-ops is exactly the bug class the delete-confirm incident produced.
- **`response.ok` on every fetch.** A missing check turns a 404 into "empty list" and hides the real bug.
- **`invalidateQueries(["chats"])`** (prefix) after any chat-list mutation; **`setQueryData`** must target the exact list key, and must wrap generated classes in `new` (§1.5).

---

## 7. Session scars — rules from real bugs

Each was a live failure in building this feature set. The rule is the takeaway; the bug is why it exists.

- **Truncated `ui.go` emission.** A partial overwrite left `Handler()` referencing ~10 handlers that were no longer in the file — a wall of `s.chat undefined` and a red build. **Rule:** never partial-emit a file with a large export/link surface (`ui.go`, `useChats.ts`, `api.ts`, `database.go`). If you cannot produce the complete file, stop and say so; a red build is worse than no change.

- **Clobbered `useChats.ts`.** A "slimmed" version left one export and removed 12; 17 TS errors across five files (`useChat`, `useSendMessage`, `useCancelMessage`, `useIsStreaming`, `useIsWaitingForLoad`, `useDownloadProgress`, `useChatError`, `useShouldShowStaleDisplay`, `useDismissStaleModel`, etc.). **Rule:** same as above. That file has 13 exports and `useSendMessage` is the streaming engine — never regenerate it from scratch.

- **Index on a migration-added column in the inline schema.** Every existing DB died on `initialize database: no such column: project_id` because `init()` aborted before `migrate()`. **Rule:** post-migrate indexes (§1.2).

- **Duplicate `ImgDir()`.** A re-declaration of `Store.ImgDir()` was added to `store.go` while `image.go` already owned it — *and* computed a different path. Go aborts the package on a duplicate at file scope; the build broke on a method that already existed. **Rule:** read before defining a method that may already exist; grep the `Store` surface first.

- **`window.menu()` from a left-click.** Staged items, returned a promise nobody resolved; the `⋯` button looked dead. Then synthetic `contextmenu` dispatch also failed (untrusted events never reach the native handler). **Rule:** DOM menu for programmatic opens; native menu only for real right-click (§1.1).

- **`window.confirm` silent no-op.** Delete appeared to do nothing because WebView2 suppressed the dialog and `confirm()` returned `false` without showing anything. **Rule:** DOM modals for confirmations (§1.11).

- **Class spread dropping `convertValues`.** `setQueryData<ChatsResponse>` with object spread was a hard type error; without the generic it wrote prototype-less objects into the cache. **Rule:** `new ChatsResponse(...)`, never spread (§1.5).

- **Tests asserted pre-soft-delete behavior.** `TestStore` and `TestChatDeletionWithCascade` asserted the chat was gone after `DeleteChat`, but delete is now soft. The production code was correct; the tests were stale. **Rule:** when a mutation's semantics change, the test that asserts the old outcome must move to the method that still implements it (`purgeChat`), and a new test must lock in the new semantics.

- **Stale codegen gate on the frontend.** `tsc -b` failed on `Property 'deletedAt' does not exist` because Go structs changed and `gotypes.gen.ts` did not — resolved only by `go generate ./app/ui/...`. **Rule:** §1.8, every time `responses/types.go` changes.

---

## 8. Known issues / deferred work

Documented so nobody rediscovers them as new bugs. The first two were already fixed — noted so nobody "re-fixes" them by reverting.

- **FIXED: list fetches had no `response.ok` checks.** `api.ts` `getChats`, `getArchivedChats`, `getDeletedChats`, `getChat`, and the project helpers now throw on non-2xx. A 404 surfaces as an error instead of reading as an empty list. Keep this.
- **FIXED: `saveRename` spread the generated classes.** It now wraps in `new ChatsResponse({...})` and `new ChatsResponse`/prototype-safe shapes. Keep this.

Still open:

1. **Delete is not instant.** `useDeleteChat.schedule` writes optimistic removal to `["chats"]`, but the active list reads `["chats","list",projectId]` (§1.9). The server delete still fires after the 6 s window and the `invalidateQueries(["chats"])` refetch cleans up; it is only the **immediate visual removal** that is lost. Fix: thread `projectId` into `useDeleteChat(projectId)` and write to the list key `["chats", "list", projectId ?? "root"]`.

2. **`useIsWaitingForLoad` only reads the unfiled list.** Its "same model recently active elsewhere" heuristic calls `useChats()` with no project param, so it ignores chats inside projects and may show the first-token loading bar more often when recent activity was in a project. Visual-only heuristic. Fix: add a `?scope=all` flag to `/api/v1/chats` or a separate all-chats endpoint and feed the heuristic from that.

3. **`/c/new` does not thread `projectId`.** New chats land unfiled; use `⋯` → Move to project. `sendMessage` in `api.ts` already accepts an 11th `projectId` arg, and the server honors `ChatRequest.projectId` on the first message — only the `useSendMessage` call site in `useChats.ts` is missing it. Fix: pass the current `selectedProjectId` into `sendMessage` from the route/sidebar.

4. **Native right-click "Move to project" opens the DOM menu at a heuristic center position.** From `ChatSidebar.tsx` `handleContextMenu`, the DOM menu is positioned near the viewport middle rather than anchored to the row (the native menu has no submenus). Functional, slightly ugly. Fix: thread the row element through the native-menu path and anchor the DOM menu to it.

5. **Empty-project delete — verify before relying on it.** `DeleteProjectDialog` gates both confirm choices on the subtree containing chats/subprojects. Before trusting the empty-project path end-to-end, open `DeleteProjectDialog.tsx` and confirm "promote" is enabled when the subtree is empty. If not, deleting an empty project from the UI has no confirm path. Fix (if needed): promote is always enabled; only "also delete conversations" disables at zero chats.

6. **`ProjectsPanel` shows only top-level projects; subprojects surface only via breadcrumb after selecting a parent.** This is the chosen B-model (§1.14). There is no inline expandable tree. If a user expects to see subprojects from the Projects panel without selecting a parent, that is a UX gap, not a bug.

7. **Native context menu is Windows-only.** On macOS `window.menu()` never renders; only the DOM `⋯` menu works. The DOM menu is the cross-platform path.

---

*This document reflects the committed state as of the projects/archive/trash work, verified against the current `app/store/database.go`, `app/store/store.go`, `app/store/image.go`, `app/ui/ui.go`, `app/ui/responses/types.go`, `app/ui/app/src/api.ts`, `hooks/useChats.ts`, `hooks/useDeleteChat.ts`, `hooks/useProjects.ts`, `components/ChatSidebar.tsx`, `components/ChatActionsMenu.tsx`, `components/ProjectsPanel.tsx`, `components/ProjectBreadcrumb.tsx`, `components/NewProjectDialog.tsx`, `components/DeleteProjectDialog.tsx`, `components/CollapsibleSection.tsx`, `app/cmd/app/app.go`, and `envconfig/config.go`. If a rule here conflicts with the code, the rule describes intent and the code is the bug — surface it rather than deleting the rule.*

