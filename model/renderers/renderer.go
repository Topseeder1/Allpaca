package renderers

import (
	"fmt"

	"github.com/topseeder1/allpaca/api"
)

type Renderer interface {
	Render(messages []api.Message, tools []api.Tool, think *api.ThinkValue) (string, error)
}

type (
	RendererConstructor func() Renderer
	RendererRegistry    struct {
		renderers map[string]RendererConstructor
	}
)

// RenderImgTags is a global flag that tells renderers to use [img] tags
// for images. This is set by the Ollama server package on init, or left as
// false for other environments where renderers are used
var RenderImgTags bool

func (r *RendererRegistry) Register(name string, renderer RendererConstructor) {
	r.renderers[name] = renderer
}

var registry = RendererRegistry{
	renderers: make(map[string]RendererConstructor),
}

func Register(name string, renderer RendererConstructor) {
	registry.Register(name, renderer)
}

func RenderWithRenderer(name string, msgs []api.Message, tools []api.Tool, think *api.ThinkValue) (string, error) {
	renderer := rendererForName(name)
	if renderer == nil {
		return "", fmt.Errorf("unknown renderer %q", name)
	}
	return renderer.Render(msgs, tools, think)
}

func rendererForName(name string) Renderer {
	if constructor, ok := registry.renderers[name]; ok {
		return constructor()
	}
	switch name {
	case "qwen3-coder":
		return &Qwen3CoderRenderer{}
	case "qwen3-vl-instruct":
		return &Qwen3VLRenderer{isThinking: false, useImgTags: RenderImgTags}
	case "qwen3-vl-thinking":
		return &Qwen3VLRenderer{isThinking: true, useImgTags: RenderImgTags}
	case "cogito":
		return &CogitoRenderer{isThinking: true}
	case "deepseek3.1":
		return &DeepSeek3Renderer{IsThinking: true, Variant: Deepseek31}
	case "olmo3":
		return &Olmo3Renderer{UseExtendedSystemMessage: false}
	case "olmo3.1":
		return &Olmo3Renderer{UseExtendedSystemMessage: true}
	case "olmo3-think":
		return &Olmo3ThinkRenderer{Variant: Olmo31Think}
	case "olmo3-32b-think":
		return &Olmo3ThinkRenderer{Variant: Olmo3Think32B}
	case "nemotron-3-nano":
		return &Nemotron3NanoRenderer{}
	case "functiongemma":
		return &FunctionGemmaRenderer{}
	case "glm-4.7":
		return &GLM47Renderer{}
	case "glm-ocr":
		return &GlmOcrRenderer{}
	case "lfm2":
		return &LFM2Renderer{IsThinking: false}
	case "lfm2-thinking":
		return &LFM2Renderer{IsThinking: true}
	case "gemma4":
		return &Gemma4Renderer{}
	// Qwen 3.5 family. Upstream names qwen3.5 and qwen3.8 renderers in the
	// model manifest as the dotted family names. The GGUF architecture
	// (general.architecture = "qwen35" / "qwen35moe") and the model-family
	// marketing names ("qwen3.6", "qwen36") are added as aliases so the
	// resolver works regardless of which name the manifest carries.
	// The default qwen3.5 constructor enables thinking and always emits an
	// empty thinking block on no-think turns so the chat template stays
	// structurally consistent — a zero-value renderer produces a template
	// the model has never seen and yields garbage output on first token.
	case "qwen3.5", "tev1", "qwen35", "qwen35moe", "qwen3.6", "qwen36":
		return &Qwen35Renderer{
			isThinking:              true,
			emitEmptyThinkOnNoThink: true,
			useImgTags:              RenderImgTags,
		}
	case "qwen3.8":
		return newQwen38Renderer()
	default:
		return nil
	}
}