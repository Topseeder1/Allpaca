package qwen35compat

import (
	"github.com/topseeder1/allpaca/model"
	"github.com/topseeder1/allpaca/model/models/qwen3next"
)

// GGUF files that declare general.architecture = "qwen35" (dense) or
// "qwen35moe" (MoE) route to the qwen3next implementation, which upstream
// extended to cover the qwen3.5 architecture family without renaming the
// package. qwen3next's own init() registers only the string "qwen3next",
// so the two GGUF-visible names are added here as aliases.
func init() {
	model.Register("qwen35", qwen3next.New)
	model.Register("qwen35moe", qwen3next.New)
}