package runner

import (
	"github.com/topseeder1/allpaca/runner/llamarunner"
	"github.com/topseeder1/allpaca/runner/ollamarunner"
	"github.com/topseeder1/allpaca/x/imagegen"
)

func Execute(args []string) error {
	if args[0] == "runner" {
		args = args[1:]
	}

	if len(args) > 0 {
		switch args[0] {
		case "--ollama-engine":
			return ollamarunner.Execute(args[1:])
		case "--imagegen-engine":
			return imagegen.Execute(args[1:])
		}
	}
	return llamarunner.Execute(args)
}
