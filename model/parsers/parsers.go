package parsers

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/topseeder1/allpaca/api"
	"github.com/topseeder1/allpaca/harmony"
)

type Parser interface {
	Init(tools []api.Tool, lastMessage *api.Message, thinkValue *api.ThinkValue) []api.Tool
	Add(s string, done bool) (content string, thinking string, calls []api.ToolCall, err error)
	HasToolSupport() bool
	HasThinkingSupport() bool
}

type ParserConstructor func() Parser

type ParserRegistry struct {
	constructors map[string]ParserConstructor
}

func (r *ParserRegistry) Register(name string, constructor ParserConstructor) {
	r.constructors[name] = constructor
}

var registry = ParserRegistry{
	constructors: make(map[string]ParserConstructor),
}

func Register(name string, constructor ParserConstructor) {
	registry.Register(name, constructor)
}

func ParserForName(name string) Parser {
	if parser, ok := registry.constructors[name]; ok {
		return parser()
	}
	var p Parser

	switch name {
	case "qwen3-coder":
		p = &Qwen3CoderParser{}
	case "qwen3-vl-instruct":
		p = &Qwen3VLParser{hasThinkingSupport: false}
	case "qwen3-vl-thinking":
		p = &Qwen3VLParser{hasThinkingSupport: true}
	case "ministral":
		p = &MinistralParser{hasThinkingSupport: false}
	case "passthrough":
		return &PassthroughParser{}
	case "harmony":
		return harmony.NewHarmonyMessageHandler()
	case "cogito":
		return &CogitoParser{}
	case "deepseek3":
		return &DeepSeek3Parser{hasThinkingSupport: true}
	case "olmo3":
		return &Olmo3Parser{}
	case "olmo3-think":
		return &Olmo3ThinkParser{}
	case "nemotron-3-nano":
		return &Nemotron3NanoParser{}
	case "functiongemma":
		return &FunctionGemmaParser{}
	case "glm-4.7":
		return &GLM47Parser{}
	case "glm-ocr":
		return &GlmOcrParser{}
	case "lfm2":
		return &LFM2Parser{hasThinkingSupport: false}
	case "lfm2-thinking":
		return &LFM2Parser{hasThinkingSupport: true}
	case "gemma4":
		p = &Gemma4Parser{hasThinkingSupport: true}
	// Qwen3.5 family — same aliasing as the renderer.
	case "qwen35", "qwen35moe", "qwen3.5", "qwen3.6", "qwen3.8", "qwen36":
		p = &Qwen35Parser{}
	default:
		return nil
	}
	return p
}

type PassthroughParser struct{}

func (p *PassthroughParser) Init(tools []api.Tool, lastMessage *api.Message, thinkValue *api.ThinkValue) []api.Tool {
	return tools
}

func (p *PassthroughParser) Add(s string, done bool) (content string, thinking string, calls []api.ToolCall, err error) {
	return s, "", nil, nil
}

func (p *PassthroughParser) HasToolSupport() bool {
	return false
}

func (p *PassthroughParser) HasThinkingSupport() bool {
	return false
}

func splitAtTag(sb *strings.Builder, tag string, trimAfter bool) (string, string) {
	split := strings.SplitN(sb.String(), tag, 2)
	if len(split) == 1 {
		sb.Reset()
		return split[0], ""
	}
	before := split[0]
	before = strings.TrimRightFunc(before, unicode.IsSpace)
	after := split[1]
	if trimAfter {
		after = strings.TrimLeftFunc(after, unicode.IsSpace)
	}
	sb.Reset()
	sb.WriteString(after)
	return before, after
}

func overlap(s, delim string) int {
	max := min(len(delim), len(s))
	for i := max; i > 0; i-- {
		if strings.HasSuffix(s, delim[:i]) {
			return i
		}
	}
	return 0
}

func trailingWhitespaceLen(s string) int {
	remaining := s
	total := 0
	for len(remaining) > 0 {
		r, size := utf8.DecodeLastRuneInString(remaining)
		if r == utf8.RuneError && size == 1 {
			break
		}
		if !unicode.IsSpace(r) {
			break
		}
		total += size
		remaining = remaining[:len(remaining)-size]
	}
	return total
}