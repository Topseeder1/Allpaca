package model

import "errors"

// ErrInvalidModelName is returned by manifest helpers when a model name fails
// validation.
var ErrInvalidModelName = errors.New("invalid model name")

// Path is the manifest-facing view of a fully-qualified Name: the name split
// into host, namespace, model, and tag parts. It keeps manifest path
// construction decoupled from Name's display helpers.
type Path struct {
	Host      string
	Namespace string
	Model     string
	Tag       string
}

// Path returns the manifest-facing Path representation of the name.
func (n Name) Path() Path {
	return Path{
		Host:      n.Host,
		Namespace: n.Namespace,
		Model:     n.Model,
		Tag:       n.Tag,
	}
}