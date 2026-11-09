```md
// File: docs/api.md
# Allpaca API

Allpaca provides a REST API for running and managing large language models locally.

The default bind address is **`http://127.0.0.1:11435`** — not 11434. Change the
port with `OLLAMA_HOST` if you need to.

The API is a superset of the upstream Ollama API. Every endpoint below works
identically to its Ollama counterpart except where noted (no `/api/push`, no
cloud auth endpoints). Existing Ollama clients work against Allpaca with a port
change and nothing else.

## Conventions

- All request bodies are JSON.
- All responses are JSON unless the endpoint streams, in which case the response
  is newline-delimited JSON (one completed JSON object per line, `Content-Type:
  application/x-ndjson`).
- Streaming endpoints accept `"stream": true` (default) or `"stream": false`.
- Durations are nanoseconds.
- Timestamps are RFC 3339 / ISO 8601.
- A model may be referenced as `<name>` (`qwen3.8`) or `<name>:<tag>`
  (`qwen3.8:27b`). Omitted tag means `latest`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/generate` | Generate a completion |
| `POST` | `/api/chat` | Generate a chat completion |
| `POST` | `/api/embed` | Generate embeddings |
| `GET`  | `/api/tags` | List locally available models |
| `POST` | `/api/show` | Show model information |
| `POST` | `/api/create` | Create a model from a Modelfile |
| `POST` | `/api/copy` | Copy a model |
| `DELETE` | `/api/delete` | Delete a model |
| `POST` | `/api/pull` | Pull a model from the registry |
| `GET`  | `/api/ps` | List running models |
| `GET`  | `/api/version` | Server version |
| `HEAD` | `/api/blobs/:digest` | Check whether a blob exists |
| `POST` | `/api/blobs/:digest` | Upload a blob (used by `/api/create`) |

**Not implemented:** `/api/push` (requires ollama.com sign-in), `/api/me` and
`/api/signout` (cloud-only). Sending `:cloud` model names will fail — Allpaca
runs models locally and does not proxy to any remote provider.

---

## Generate a completion

```
POST /api/generate
```

Generate a response for a given prompt with a provided model. The endpoint
streams the response unless `"stream": false`.

### Request

```json
{
  "model": "qwen3.8:27b",
  "prompt": "Why is the sky blue?",
  "stream": false
}
```

### Parameters

| Field | Type | Required | Description |
|---|---|---|---|
| `model` | string | yes | Model name |
| `prompt` | string | yes | Prompt text |
| `suffix` | string | no | Text after the model response |
| `images` | string[] | no | Base64-encoded images (vision models) |
| `format` | string \| object | no | `"json"` or a JSON schema object |
| `options` | object | no | Runtime options (see below) |
| `system` | string | no | Override the system message |
| `template` | string | no | Override the prompt template |
| `stream` | boolean | no | Stream partial responses (default `true`) |
| `raw` | boolean | no | Skip templating; send prompt verbatim |
| `keep_alive` | string \| number | no | How long to keep the model loaded (e.g. `"5m"`, `0`) |
| `context` | int[] | no | Context from a prior `/api/generate` call (deprecated) |
| `think` | boolean \| string | no | Enable thinking output on reasoning models; string levels where supported |

### Non-streaming response

```json
{
  "model": "qwen3.8:27b",
  "created_at": "2026-11-08T15:30:00.000000000Z",
  "response": "The sky appears blue because molecules in the atmosphere scatter short-wavelength light more than long-wavelength light.",
  "done": true,
  "done_reason": "stop",
  "total_duration": 5284213000,
  "load_duration": 41203000,
  "prompt_eval_count": 12,
  "prompt_eval_duration": 130000000,
  "eval_count": 47,
  "eval_duration": 5100000000
}
```

### Streaming response

Each line is a completed JSON object. The final line has `"done": true`.

```json
{"model":"qwen3.8:27b","created_at":"...","response":"The" ,"done":false}
{"model":"qwen3.8:27b","created_at":"...","response":" sky","done":false}
{"model":"qwen3.8:27b","created_at":"...","response":" appears","done":false}
{"model":"qwen3.8:27b","created_at":"...","response":"","done":true,"done_reason":"stop","total_duration":...,"eval_count":47,...}
```

---

## Generate a chat completion

```
POST /api/chat
```

Generate the next message in a chat with a provided model. Supports tool calling
and vision input. Same streaming semantics as `/api/generate`.

### Request

```json
{
  "model": "qwen3.8:27b",
  "messages": [
    { "role": "user", "content": "Why is the sky blue?" }
  ],
  "stream": false
}
```

### Message fields

| Field | Type | Description |
|---|---|---|
| `role` | string | `system`, `user`, `assistant`, or `tool` |
| `content` | string | Message text |
| `thinking` | string | Reasoning content (returned by thinking models) |
| `images` | string[] | Base64-encoded images (user role only) |
| `tool_calls` | object[] | Tool calls made by the assistant |
| `tool_name` | string | Tool name (tool role only) |

### Request parameters

Same `options`, `format`, `keep_alive`, `think`, `stream`, `tools` as
`/api/generate`, plus:

| Field | Type | Description |
|---|---|---|
| `messages` | object[] | Conversation so far (required) |
| `tools` | object[] | Tool definitions available to the model |

### Response

```json
{
  "model": "qwen3.8:27b",
  "created_at": "2026-11-08T15:30:00.000000000Z",
  "message": {
    "role": "assistant",
    "content": "The sky appears blue because..."
  },
  "done": true,
  "done_reason": "stop",
  "total_duration": 5284213000,
  "load_duration": 41203000,
  "prompt_eval_count": 24,
  "prompt_eval_duration": 180000000,
  "eval_count": 47,
  "eval_duration": 5100000000
}
```

### Tool calling

Provide `tools` and the model may return `tool_calls` in `message`:

```json
{
  "model": "qwen3.8:27b",
  "messages": [ { "role": "user", "content": "What's the weather in Toronto?" } ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_current_weather",
        "description": "Get the current weather for a city",
        "parameters": {
          "type": "object",
          "required": ["city"],
          "properties": {
            "city": { "type": "string", "description": "City name" }
          }
        }
      }
    }
  ],
  "stream": false
}
```

Response:

```json
{
  "model": "qwen3.8:27b",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "function": {
          "name": "get_current_weather",
          "arguments": { "city": "Toronto" }
        }
      }
    ]
  },
  "done": true
}
```

Send the tool result back on the next turn with `"role": "tool"` and
`"tool_name"`:

```json
{
  "model": "qwen3.8:27b",
  "messages": [
    { "role": "user", "content": "What's the weather in Toronto?" },
    { "role": "assistant", "content": "", "tool_calls": [ ... ] },
    { "role": "tool", "tool_name": "get_current_weather", "content": "12°C, clear" }
  ]
}
```

---

## Generate embeddings

```
POST /api/embed
```

Generate embeddings from a model.

### Request

```json
{
  "model": "embeddinggemma-2",
  "input": "Here is an article about llamas..."
}
```

`input` may be a string or an array of strings to embed in one request.

### Response

```json
{
  "model": "embeddinggemma-2",
  "embeddings": [
    [0.010071029, -0.0017594862, 0.05007221, ...]
  ],
  "total_duration": 14143917,
  "load_duration": 1019500,
  "prompt_eval_count": 8
}
```

When `input` is an array, `embeddings` has one entry per input string, in order.

---

## List local models

```
GET /api/tags
```

### Response

```json
{
  "models": [
    {
      "name": "qwen3.8:27b",
      "model": "qwen3.8:27b",
      "modified_at": "2026-11-08T10:00:00.000000000Z",
      "size": 18530201888,
      "digest": "sha256:abc123...",
      "details": {
        "parent_model": "",
        "format": "gguf",
        "family": "qwen3",
        "families": ["qwen3"],
        "parameter_size": "27B",
        "quantization_level": "Q4_K_M"
      }
    }
  ]
}
```

Allpaca resolves models from `ALLPACA_MODELS` first, then `OLLAMA_MODELS`. The
`name` reflects the registry path the model was pulled from, and two roots never
produce duplicate entries — the Allpaca copy wins on collision.

---

## Show model information

```
POST /api/show
```

### Request

```json
{ "model": "qwen3.8:27b" }
```

### Response

```json
{
  "modelfile": "# Modelfile generated by \"allpaca show\"...",
  "parameters": "stop \"<|im_end|>\"",
  "template": "...",
  "details": {
    "parent_model": "",
    "format": "gguf",
    "family": "qwen3",
    "families": ["qwen3"],
    "parameter_size": "27B",
    "quantization_level": "Q4_K_M"
  },
  "model_info": {
    "general.architecture": "qwen3",
    "qwen3.context_length": 262144,
    ...
  },
  "capabilities": ["completion", "tools", "thinking", "vision"]
}
```

`capabilities` is how the desktop app decides what a model can do — it gates the
Tools toggle, the vision attachment button, and the thinking indicator.

---

## Create a model

```
POST /api/create
```

Create a model from a Modelfile, from an existing model, or from a Safetensors
directory.

### Request

```json
{
  "model": "mario",
  "from": "qwen3.8:27b",
  "system": "You are Mario from Super Mario Bros, acting as an assistant.",
  "parameters": {
    "temperature": 0.8,
    "stop": ["<|im_start|>", "<|im_end|>"]
  },
  "stream": true
}
```

Or with a raw Modelfile body via the `modelfile` field.

### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | string | Name of the new model |
| `from` | string | Existing model to base it on |
| `files` | object | Files referenced by the Modelfile |
| `adapters` | object | LoRA adapters to include |
| `template` | string | Override the prompt template |
| `license` | string | License text |
| `system` | string | System prompt |
| `parameters` | object | Runtime defaults |
| `messages` | object[] | Example conversation |
| `stream` | boolean | Stream progress (default `true`) |

Streaming responses are `{"status": "..."}` progress lines ending with
`{"status": "success"}`.

---

## Copy a model

```
POST /api/copy
```

```json
{ "source": "qwen3.8:27b", "destination": "qwen3.8:27b-backup" }
```

Returns `200` with an empty body on success.

---

## Delete a model

```
DELETE /api/delete
```

```json
{ "model": "qwen3.8:27b-backup" }
```

Returns `200` on success, `404` if the model doesn't exist.

---

## Pull a model

```
POST /api/pull
```

Downloads a model from the public registry (`registry.ollama.ai` by default —
this is not authenticated; anonymous pulls work exactly as they do with
`ollama`).

### Request

```json
{
  "model": "qwen3.8:27b",
  "stream": true,
  "insecure": false
}
```

### Streaming response

```json
{"status":"pulling manifest"}
{"status":"pulling abc123...","digest":"sha256:abc123...","total":18530201888,"completed":1048576}
{"status":"verifying sha256 digest"}
{"status":"writing manifest"}
{"status":"success"}
```

To point at a different registry, set `OLLAMA_REMOTES`.

---

## List running models

```
GET /api/ps
```

```json
{
  "models": [
    {
      "name": "qwen3.8:27b",
      "model": "qwen3.8:27b",
      "size": 18530201888,
      "digest": "sha256:abc123...",
      "details": { ... },
      "expires_at": "2026-11-08T15:35:00.000000000Z",
      "size_vram": 16530201888
    }
  ]
}
```

`size_vram` is the portion of the model resident in VRAM. CPU-only models
report `0`.

---

## Version

```
GET /api/version
```

```json
{ "version": "0.1.0" }
```

---

## Blobs

Used internally by `/api/create`.

```
HEAD /api/blobs/:digest
```

Returns `200` if the blob exists, `404` otherwise.

```
POST /api/blobs/:digest
```

Upload a raw blob. The digest in the URL must match the SHA256 of the request
body.

---

## Runtime options

Passed as the `options` object on `/api/generate` or `/api/chat`:

| Option | Default | Description |
|---|---|---|
| `num_keep` | `4` | Tokens to keep from the initial prompt |
| `seed` | `0` | Random seed (`0` means random) |
| `num_predict` | `-1` | Max tokens to generate (`-1` means until stop) |
| `top_k` | `40` | Top-K sampling |
| `top_p` | `0.9` | Top-P sampling |
| `min_p` | `0.0` | Min-P sampling |
| `typical_p` | `1.0` | Typical-P sampling |
| `repeat_last_n` | `64` | Window for repeat penalty |
| `temperature` | `0.8` | Sampling temperature |
| `repeat_penalty` | `1.1` | Repetition penalty |
| `presence_penalty` | `0.0` | Presence penalty |
| `frequency_penalty` | `0.0` | Frequency penalty |
| `mirostat` | `0` | Mirostat mode (0/1/2) |
| `mirostat_tau` | `5.0` | Mirostat target entropy |
| `mirostat_eta` | `0.1` | Mirostat learning rate |
| `stop` | — | Stop sequence(s); may be a string or array |
| `num_ctx` | `4096` | Context window |
| `num_batch` | `512` | Batch size |
| `num_gpu` | `-1` | Layers to offload to GPU (`-1` = auto) |
| `main_gpu` | `0` | Primary GPU index |
| `use_mmap` | `true` | Memory-map model files |
| `num_thread` | auto | CPU threads |
| `num_thread_batch` | auto | Batch threads |
| `flash_attn` | auto | `true` / `false` / unset for backend choice |

---

## Structured output

Set `format: "json"` to constrain the response to valid JSON:

```json
{
  "model": "qwen3.8:27b",
  "prompt": "Return a JSON object with keys city and population for Toronto.",
  "format": "json",
  "stream": false
}
```

Or pass a JSON schema and get a response conforming to it:

```json
{
  "model": "qwen3.8:27b",
  "prompt": "Return contact info for Jane Doe.",
  "format": {
    "type": "object",
    "properties": {
      "name": { "type": "string" },
      "email": { "type": "string" }
    },
    "required": ["name", "email"]
  },
  "stream": false
}
```

---

## Image generation (experimental)

`/api/generate` accepts image-generation parameters. Supplying any of them
switches the model from text generation to image generation — a different model
family (e.g. a diffusion model) is required.

### Request

```json
{
  "model": "some-image-model",
  "prompt": "A red panda sitting on a wooden fence at sunset",
  "width": 1024,
  "height": 1024,
  "steps": 20,
  "seed": 42,
  "stream": false
}
```

### Parameters

| Field | Type | Description |
|---|---|---|
| `width` | int | Image width in pixels |
| `height` | int | Image height in pixels |
| `steps` | int | Diffusion steps (quality vs. speed tradeoff) |
| `seed` | int | Reproducibility seed |

### Response

The response includes a base64-encoded image in the `image` field:

```json
{
  "model": "some-image-model",
  "created_at": "2026-11-08T15:30:00.000000000Z",
  "image": "iVBORw0KGgoAAAANSUhEUgAABAAAAAQAA...",
  "done": true,
  "done_reason": "stop",
  "total_duration": 41200500000
}
```

The `image` field is PNG data, base64-encoded without a data-URL prefix. Decode
and write it to a `.png` file to inspect it.

This is experimental. Behavior and parameter names may change between releases.

---

## OpenAI compatibility

Allpaca serves an OpenAI-compatible surface under `/v1` in addition to the
native `/api` endpoints. This lets tools built against OpenAI's SDKs work against
a local model without code changes.

Base URL: `http://127.0.0.1:11435/v1`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/chat/completions` | Chat completions (same shape as OpenAI's) |
| `POST` | `/v1/completions` | Legacy completions |
| `POST` | `/v1/embeddings` | Embeddings |
| `GET`  | `/v1/models` | List models |
| `GET`  | `/v1/models/{model}` | Get model metadata |

### Example

```shell
curl http://localhost:11435/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.8:27b",
    "messages": [
      { "role": "user", "content": "Why is the sky blue?" }
    ]
  }'
```

Set `OPENAI_API_KEY` for clients that insist on one — the value is ignored.

Implementation lives in [`middleware/openai.go`](../middleware/openai.go).
Translation is request-and-response shape only; behavior underneath is identical
to the native `/api` endpoints. Streaming, tool calling, and vision inputs all
work through the OpenAI surface.
```

