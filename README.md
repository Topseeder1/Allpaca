```md
// File: README.md
<div align="center">

# Allpaca

**A Seedling Remix of Ollama — a bespoke, upgraded inference engine for the Spaces ecosystem.**

[Spaces](https://spacesbyseedling.com/remixes) · [Report an issue](https://github.com/topseeder1/allpaca/issues)

</div>

---

Allpaca runs large language models entirely on your own machine. It is a Seedling
Remix of Ollama — not a reskin, but a re-engineered build with its own desktop chat
app, its own install tree, its own GPU backend packaging, and a feature set aimed at
actually managing a working library of conversations.

**Drop-in Ollama compatible:** the same `POST /api/chat`, `POST /api/generate`,
`GET /api/tags` and everything else — served on **port 11435** instead of 11434.
Point any existing Ollama client at the new port and it works.

## Install

### Windows

Download `AllpacaSetup.exe` from [spacesbyseedling.com/remixes](https://spacesbyseedling.com/remixes).

The installer is self-contained (~650 MB) because it bundles **CUDA 13** and
**Vulkan** runtimes alongside the CPU backends. You do not need a separate CUDA
toolkit or Vulkan SDK — the required DLLs ship inside the package.

During setup you choose where models live. The default is `%USERPROFILE%\.allpaca\models`;
this is written to the `ALLPACA_MODELS` environment variable. You can point it at any
drive with free space.

Uninstalling preserves your conversations and settings by default. A checkbox in the
uninstaller offers to remove them; leave it unchecked and `db.sqlite` survives, so a
reinstall picks up where you left off.

### macOS and Linux

Allpaca is currently distributed as a Windows build. On other platforms, build from
source (see [Building](#building)). The inference engine, CLI, and REST API are
portable; only the desktop shell is Windows-specific in the shipped package.

## Quickstart

```shell
allpaca run qwen3.8:27b
```

Downloads the model, loads it, drops you into a chat prompt.

Server listens on **`http://127.0.0.1:11435`**. Existing Ollama tooling works with a
port change.

## How `allpaca pull` works

Models are **files on disk**, not a database. There is no model registry table, no
install record, no state in `db.sqlite`. `db.sqlite` holds your conversations, projects,
archive, trash, and settings — that's it.

```
$ALLPACA_MODELS/
├── manifests/registry.ollama.ai/library/qwen3.8/27b   ← small JSON pointer (~1 KB)
└── blobs/
    ├── sha256-aaaa…                                    ← config + template
    └── sha256-bbbb…                                    ← actual weights (multi-GB)
```

`allpaca pull <model>`:

1. `GET https://registry.ollama.ai/v2/library/<model>/manifests/<tag>` → small JSON
2. Write it to the manifest path above
3. For each layer listed in the manifest, check `blobs/sha256-<digest>` — **skip if
   present**, download if not
4. Done

`allpaca run <model>` reverses it: read manifest → resolve blob paths → hand to ggml →
load into VRAM/RAM.

**No sign-in is required to pull.** The registry is a public Docker-registry-v2 endpoint
and anonymous pulls work exactly as they do with `ollama`. Sign-in only matters for
cloud models (which Allpaca does not use — see [No cloud](#no-cloud-models)).

**No mirror.** Allpaca does not host its own registry. Model names are whatever
[ollama.com/library](https://ollama.com/library) publishes. If you want to run against a
different registry, set `OLLAMA_REMOTES`.

## What Spaces is

Spaces is Seedling's ecosystem launcher — a single window that hosts a family of AI
tools, tracks what is installed and running, and routes their inference through one
local gateway. Allpaca is one of the apps you launch inside Spaces, alongside the other
Seedling Remixes.

Underneath Spaces is **ArrP** (the ArrP Protocol): the router that watches your hardware,
decides what can run in parallel and what has to queue, and streams model output over a
local port. Spaces is the UI, ArrP is the router, Allpaca is the Remix.

A **Remix** is Seedling's published rendition of an upstream tool — rebuilt, hardened
and upgraded, the way a coachbuilder reworks a chassis. Allpaca is not stock Ollama. It
is a distinct product, published by Seedling.

## What Allpaca adds over Ollama

### Chat management built in

The desktop app is a real workspace, not a single scrolling transcript.

- **Nested projects** — self-referential project tree with unlimited depth. Select a
  project to filter the chat list; a breadcrumb walks back up; child-project chips let
  you drill into subprojects. Move any chat between projects from the row's action menu.
- **Archive** — archive a conversation instead of deleting it. Archived chats drop out
  of the active list and live in their own section. Archive state survives a
  delete-then-restore round trip.
- **Recently Deleted** — deleting a conversation moves it to a 30-day trash instead of
  destroying it. Restore with one click, or delete forever. Chats are purged
  automatically after 30 days.
- **Undo on delete** — a 6-second undo toast instead of a blocking confirmation dialog.
- **Reply auto-restore** — sending a message into an archived or trashed chat brings it
  back automatically, the way replying to an archived Gmail thread does.

Every destructive action is recoverable. Only explicit "delete forever" or the 30-day
purge actually removes a conversation.

### Model management

- **Dual model roots.** `ALLPACA_MODELS` is checked first, `OLLAMA_MODELS` second. You
  can point Allpaca at your existing Ollama model directory with no re-downloading, and
  add a second directory for Allpaca-only models.
- **Origin badges.** The model picker shows whether a model resolved from the Allpaca
  directory or the Ollama fallback.
- **Install-time model location picker.** Choose the storage drive during setup;
  change it later in Settings.

### GPU backends, bundled and tuned

The installer ships:

| Backend | Location in install tree |
|---|---|
| CPU (7 tuned variants: x64, SSE4.2, Sandy Bridge, Haswell, Skylake-X, Ice Lake, Alder Lake) | `lib\allpaca\` |
| CUDA 13 (with `cublas64_13.dll` and `cublasLt64_13.dll` bundled) | `lib\allpaca\cuda_v13\` |
| Vulkan (with `vulkan-1.dll` bundled) | `lib\allpaca\vulkan\` |

No external GPU runtime install required. The installer is larger because of it.

### Ollama compatibility

The REST API surface is unchanged. `/api/chat`, `/api/generate`, `/api/tags`,
`/api/show`, `/api/pull`, `/api/embed`, `/api/ps`, and the OpenAI-compatible endpoints
all work the same way. Only two things differ for existing tooling:

1. **Port 11435** instead of 11434.
2. **Binary name** `allpaca` instead of `ollama`.

Everything else — request shapes, response shapes, streaming JSONL, tool calling, vision
input — is compatible.

### No cloud models

Allpaca runs models locally. It does not sign in to any cloud provider and does not
proxy inference to a remote endpoint. Cloud-tagged model variants (`:cloud`,
`:NNB-cloud`) exist in the ollama.com catalog but **will not run in Allpaca** — they
require an authenticated connection Allpaca doesn't make.

If you see a `-cloud` tag anywhere in the registry, skip it.

## Model catalog

These are models Allpaca can pull and run on **Windows CPU / CUDA 13 / Vulkan**. This
is a starting point, not the full catalog — `allpaca pull <model>` works with any public
model in the ollama.com registry. The names below are whatever the registry publishes;
Allpaca does not rename or mirror them.

**Not listed** because they won't run on Allpaca's Windows install: anything with
`-mlx` in the tag (Apple Silicon only, no MLX backend shipped on Windows) and anything
with `-cloud` in the tag (requires ollama.com sign-in). Also not listed: decision models
like `clef`, `clef-flash`, and `nimble` — they pull and load fine, but produce useful
output only through a `/v1/systemone` API that Allpaca doesn't proxy yet.

### Small (2.8 – 9.5 GB) — runs on almost anything

| Model | Size | Why | Command |
|---|---|---|---|
| `nemotron-3-nano:4b` | 2.8 GB | NVIDIA's smallest capable model. 256K context. Runs on integrated graphics. | `allpaca run nemotron-3-nano:4b` |
| `gemma4:e2b` | 4.6–7.5 GB | Google Gemma 4, edge-optimized. Multimodal (text + image). | `allpaca run gemma4:e2b` |
| `gemma4:e4b` | 6.6–9.5 GB | Gemma 4 mid-edge. Adds audio understanding. | `allpaca run gemma4:e4b` |
| `ornith-1.5:9b` | 6.6 GB | Self-improving foundation model. Vision + tools + thinking. 256K ctx. | `allpaca run ornith-1.5:9b` |
| `nemotron-3.5-bolt:e4b` | 7.2–7.9 GB | Compact VLM from NVIDIA. Vision + audio + tool use. 128K ctx. | `allpaca run nemotron-3.5-bolt:e4b` |
| `gemma4:12b` | 7.7–8.0 GB | Gemma 4 dense. 256K ctx. Strong general reasoning. | `allpaca run gemma4:12b` |

### Mid (11 – 32 GB) — 16-24 GB VRAM or high-RAM CPU

| Model | Size | Why | Command |
|---|---|---|---|
| `gemma4:26b` | 16–19 GB | Gemma 4 MoE with 4B active. 256K ctx. Fast for its capability. | `allpaca run gemma4:26b` |
| `qwen3.8:27b` | 18 GB | Best all-rounder. Coding, tools, thinking, vision. 256K ctx. | `allpaca run qwen3.8:27b` |
| `glm-4.7-flash:q4_K_M` | 19 GB | 30B MoE with tools + thinking. 198K ctx. Strong at agentic coding. | `allpaca run glm-4.7-flash:q4_K_M` |
| `gemma4:31b` | 19–20 GB | Gemma 4 dense flagship. 256K ctx. Frontier-level local. | `allpaca run gemma4:31b` |
| `nemotron-3.5-lightning` | 19–25 GB | NVIDIA 30B MoE with 3B active. **1M context.** Agentic focus. | `allpaca run nemotron-3.5-lightning` |
| `nemotron3:33b` | 21–28 GB | Nemotron Nano Omni. Text + image + video + audio. 128K ctx. | `allpaca run nemotron3:33b` |
| `ornith-1.5:35b` | 23 GB | Ornith mid-tier. Vision + tools + thinking. | `allpaca run ornith-1.5:35b` |
| `nemotron-3.5-bolt` | 25 GB | NVIDIA 74B MoE with 9B active. 256K ctx. Strong on coding + tool use. | `allpaca run nemotron-3.5-bolt` |
| `glm-4.7-flash:q8_0` | 32 GB | GLM-4.7-Flash at higher precision. When you have the VRAM. | `allpaca run glm-4.7-flash:q8_0` |

### Large (60 GB+) — 48 GB VRAM, multi-GPU, or high-bandwidth CPU (very slow)

| Model | Size | Why | Command |
|---|---|---|---|
| `glm-4.7-flash:bf16` | 60 GB | Full-precision GLM-4.7-Flash. | `allpaca run glm-4.7-flash:bf16` |
| `ornith-1.5:122b` | 73–77 GB | Ornith large. Frontier-level for its size. Vision + tools. | `allpaca run ornith-1.5:122b` |
| `mistral-medium-3.5` | 80 GB | 128B dense flagship. Vision + reasoning. 256K ctx. | `allpaca run mistral-medium-3.5` |
| `nemotron-3.5-super` | 80–90 GB | 120B MoE with 12B active. **1M context.** Vision + tools. | `allpaca run nemotron-3.5-super` |
| `ornith-1.5:397b` | 242 GB | Ornith frontier. Multi-GPU only in practice. | `allpaca run ornith-1.5:397b` |

### Embeddings (300 MB – 1.3 GB) — for RAG and semantic search

Use `pull` not `run` — these don't chat.

| Model | Size | Why | Command |
|---|---|---|---|
| `embeddinggemma-2:270m` | 304–378 MB | Smallest. Text-only. 8K ctx. 128d/256d/512d/768d MRL truncation. | `allpaca pull embeddinggemma-2:270m` |
| `embeddinggemma-2:440m` | 671–714 MB | Adds vision encoder. | `allpaca pull embeddinggemma-2:440m` |
| `embeddinggemma-2:570m` | 918–990 MB | Text-only, larger backbone. | `allpaca pull embeddinggemma-2:570m` |
| `embeddinggemma-2:740m` | 1.3 GB | Multimodal flagship — text, image, video, audio. 768d output. | `allpaca pull embeddinggemma-2:740m` |

## Suggestions by hardware

Rough guidance. Actual fit depends on quantization and context length — a 19 GB model at
256K context will need more VRAM than the same model at 4K context.

| Your hardware | Recommended |
|---|---|
| **8 GB RAM, no GPU** | `nemotron-3-nano:4b` (2.8 GB) — smallest capable model. `embeddinggemma-2:270m` for embeddings. |
| **16 GB RAM, CPU only** | `gemma4:e2b` (4.6 GB), `gemma4:e4b` (6.6 GB), or `nemotron-3.5-bolt:e4b` (7.2 GB). Expect slow but usable. |
| **16 GB VRAM** (RTX 4060 Ti, 4070, RX 7800 XT) | `gemma4:12b`, `gemma4:26b`, or `qwen3.8:27b` at reduced context. |
| **24 GB VRAM** (RTX 3090, 4090, A6000) | `qwen3.8:27b` at full context, `gemma4:31b`, `glm-4.7-flash:q4_K_M`, `nemotron-3.5-lightning`. |
| **48 GB VRAM** (dual 3090, A6000 Ada) | `nemotron-3.5-bolt`, `glm-4.7-flash:q8_0`, `mistral-medium-3.5` at reduced context. |
| **80 GB+ VRAM** (A100, H100, multi-GPU) | `nemotron-3.5-super`, `mistral-medium-3.5`, `ornith-1.5:122b`. |
| **Long documents** (1M context) | `nemotron-3-nano:30b`, `nemotron-3.5-lightning`, `nemotron-3.5-super`. |
| **Coding focus** | `qwen3.8:27b`, `glm-4.7-flash`, `nemotron-3.5-bolt`. |
| **Vision** (OCR, image Q&A) | `qwen3.8:27b`, any `gemma4`, `ornith-1.5:*`, `nemotron3`. |
| **Audio** (speech transcription, sound) | `gemma4:e2b` / `e4b`, `nemotron3`, `nemotron-3.5-bolt:e4b`. |
| **Agentic / tool calling** | `nemotron-3.5-lightning`, `qwen3.8:27b`, `glm-4.7-flash`. |

## Chat management reference

### Projects

Nested projects are stored in a `projects` table with a self-referential `parent_id`.
Deleting a project removes the project tree but never destroys the conversations inside
it: the dialog asks whether to move its chats to Unfiled or into the 30-day trash.

### Archive

Archiving a chat removes it from the active list. No expiry; archived chats stay until
you unarchive them. Replying unarchives automatically.

### Recently Deleted

Deleted chats move to the trash for 30 days. A purge runs on startup after the window
expires. Manual "delete forever" skips the wait.

Every operation is a single `UPDATE` on the `chats` table, so transitions are instant and
there's no risk of a chat landing in two lists at once.

## CLI reference

Binary is `allpaca`. Commands mirror Ollama's with that name substitution.

```shell
allpaca run llama3.2               # download + chat
allpaca create mymodel -f ./Modelfile
allpaca pull llama3.2              # download or update
allpaca rm llama3.2
allpaca cp llama3.2 my-model
allpaca list                       # local models
allpaca ps                         # running models
allpaca stop llama3.2
allpaca show llama3.2
allpaca run llava "What's in this image? C:\Users\you\photo.png"
allpaca serve                      # standalone server (desktop app does this itself)
```

Multiline at the interactive prompt: wrap in `"""`.

## REST API

Listens on `http://127.0.0.1:11435`.

```shell
curl http://localhost:11435/api/generate -d '{
  "model": "qwen3.8:27b",
  "prompt": "Why is the sky blue?"
}'
```

```shell
curl http://localhost:11435/api/chat -d '{
  "model": "qwen3.8:27b",
  "messages": [
    { "role": "user", "content": "Why is the sky blue?" }
  ]
}'
```

See [`docs/api.md`](./docs/api.md) for the full endpoint reference. Request and response
shapes are identical to Ollama's; only the port differs.

## Configuration

| Env var | Purpose |
|---|---|
| `ALLPACA_MODELS` | Primary model directory. Checked first. |
| `OLLAMA_MODELS` | Fallback model directory. Used when `ALLPACA_MODELS` is unset or the model isn't there. |
| `ALLPACA_LIBRARY_PATH` | Override the GPU backend search path (default: `<install>\lib\allpaca`). |
| `OLLAMA_HOST` | Bind address for the server (default `127.0.0.1:11435`). |
| `OLLAMA_REMOTES` | Remote host allowlist for model routing (default `ollama.com`). |

**Recommendation:** for compatibility with existing Ollama CLI tooling and to avoid
edge cases in older code paths, set both `ALLPACA_MODELS` and `OLLAMA_MODELS` to the
same directory.

## Building

### Requirements

- **Go** ≥ 1.24
- **Node.js** and **npm**
- **CMake** ≥ 3.21
- **Visual Studio 2022** or MSVC Build Tools (Windows)
- CUDA toolkit if you want to build the CUDA backend locally
- Vulkan SDK if you want to build the Vulkan backend locally

### Windows build

From repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_windows.ps1
```

That runs: CPU backend → CUDA backends (all detected) → ROCm (if present) → Vulkan (if
present) → `allpaca.exe` CLI → frontend `npm run build` → `go generate` →
`windows-allpaca-app-amd64.exe` desktop app → downloads VC++ redistributables → ISCC →
zip.

Skip GPU backends for a fast CPU-only build:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_windows.ps1 cpu ollama app deps installer
```

Build the installer alone (after binaries exist in `dist\`):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build_windows.ps1 installer
```

**Long paths:** the Vulkan shader generator's nested CMake project can exceed Windows'
260-character limit. If the Vulkan step fails with MSBuild `MAX_PATH` errors:

```powershell
subst X: C:\path\to\repo
cd X:\
powershell -ExecutionPolicy Bypass -File .\scripts\build_windows.ps1 vulkan
subst X: /D
```

### Dev mode

```shell
# Terminal 1: Vite
cd app/ui/app
npm run dev

# Terminal 2: after Vite is up
go run ./app/cmd/app --dev
```

**The desktop window loads its frontend from `dist/` embedded in the Go binary, not from
Vite.** After changing `.tsx` / `.ts` / `.css`, run `npm run build` in `app/ui/app` and
restart the Go process. Vite HMR only applies if you open `http://127.0.0.1:5173` in a
browser directly.

### Manual build (server + CLI only)

```shell
go build -o allpaca.exe .
./allpaca.exe serve
```

In a separate shell:

```shell
./allpaca.exe run qwen3.8:27b
```

## License and attribution

Allpaca is distributed by Seedling. Built on the **llama.cpp** / **ggml** inference
stack, founded by Georgi Gerganov — the same engine that powers Ollama and many other
local inference tools.

Upstream Ollama is the project this Remix was forked from. Its architecture, API design,
and model format handling informed this build substantially. We credit the Ollama team
for the foundation.

See [`LICENSE`](./LICENSE) for the specific terms.

---

*Allpaca — a Seedling Remix. Bespoke builds for the Spaces ecosystem.*
```