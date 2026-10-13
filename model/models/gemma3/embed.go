package gemma3

import (
	"github.com/topseeder1/allpaca/fs"
	"github.com/topseeder1/allpaca/ml"
	"github.com/topseeder1/allpaca/ml/nn"
	"github.com/topseeder1/allpaca/ml/nn/pooling"
	"github.com/topseeder1/allpaca/model"
	"github.com/topseeder1/allpaca/model/input"
	"github.com/topseeder1/allpaca/tokenizer"
)

type embedModel struct {
	model.Base
	tokenizer.Tokenizer

	*TextModel
	poolingType pooling.Type

	Dense [2]*nn.Linear `gguf:"dense"`
}

func (m *embedModel) Forward(ctx ml.Context, batch input.Batch) (ml.Tensor, error) {
	hiddenStates := m.TextModel.Forward(ctx, batch, m.Cache)
	hiddenStates = m.poolingType.Forward(ctx, hiddenStates)
	for _, dense := range m.Dense {
		hiddenStates = dense.Forward(ctx, hiddenStates)
	}
	hiddenStates = hiddenStates.L2Norm(ctx, 1e-12)
	return hiddenStates, nil
}

func newEmbedModel(c fs.Config) (model.Model, error) {
	m := &embedModel{
		Tokenizer: tokenizer.NewSentencePiece(
			&tokenizer.Vocabulary{
				Values: c.Strings("tokenizer.ggml.tokens"),
				Scores: c.Floats("tokenizer.ggml.scores"),
				Types:  c.Ints("tokenizer.ggml.token_type"),
				AddBOS: c.Bool("tokenizer.ggml.add_bos_token", true),
				BOS:    []int32{int32(c.Uint("tokenizer.ggml.bos_token_id"))},
				AddEOS: c.Bool("tokenizer.ggml.add_eos_token", false),
				EOS: append(
					[]int32{
						int32(c.Uint("tokenizer.ggml.eos_token_id")),
						int32(c.Uint("tokenizer.ggml.eot_token_id", 106)),
					},
					c.Ints("tokenizer.ggml.eos_token_ids")...,
				),
			},
		),
		TextModel:   newTextModel(c),
		poolingType: pooling.Type(c.Uint("pooling_type", 0)),
	}

	return m, nil
}
