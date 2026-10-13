package manifest

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
)

type Layer struct {
	MediaType string `json:"mediaType"`
	Digest    string `json:"digest"`
	Size      int64  `json:"size"`
	From      string `json:"from,omitempty"`
	Name      string `json:"name,omitempty"` // tensor name, e.g., "text_encoder/model.embed_tokens.weight"
	Status    string `json:"-"`
}

const (
	MediaTypeImageTensor = "application/vnd.ollama.image.tensor"
)

func NewLayer(r io.Reader, mediatype string) (Layer, error) {
	blobs, err := BlobsPath("")
	if err != nil {
		return Layer{}, err
	}

	temp, err := os.CreateTemp(blobs, "sha256-")
	if err != nil {
		return Layer{}, err
	}
	defer temp.Close()
	defer os.Remove(temp.Name())

	sha256sum := sha256.New()
	n, err := io.Copy(io.MultiWriter(temp, sha256sum), r)
	if err != nil {
		return Layer{}, err
	}

	if err := temp.Close(); err != nil {
		return Layer{}, err
	}

	digest := fmt.Sprintf("sha256:%x", sha256sum.Sum(nil))
	blob, err := BlobsPath(digest)
	if err != nil {
		return Layer{}, err
	}

	status := "using existing layer"
	if _, err := os.Stat(blob); err != nil {
		status = "creating new layer"
		if err := os.Rename(temp.Name(), blob); err != nil {
			return Layer{}, err
		}
		if err := os.Chmod(blob, 0o644); err != nil {
			return Layer{}, err
		}
	}

	return Layer{
		MediaType: mediatype,
		Digest:    digest,
		Size:      n,
		Status:    fmt.Sprintf("%s %s", status, digest),
	}, nil
}

// NewLayerFromLayer builds a Layer for a blob that already exists on disk,
// searching every models root in precedence order. If the blob is not present
// in any root, the layer is returned with Size -1 and no error, matching the
// behavior callers rely on for manifests that point at remote blobs.
func NewLayerFromLayer(digest, mediatype, from string) (Layer, error) {
	if digest == "" {
		return Layer{}, errors.New("creating new layer from layer with empty digest")
	}

	layer := Layer{
		MediaType: mediatype,
		Digest:    digest,
		Size:      -1,
		From:      from,
	}

	blobPath, err := FindBlobPath(digest)
	if err != nil {
		// Blob not present in any root: keep Size -1, matching prior behavior
		if errors.Is(err, ErrManifestNotFound) {
			return layer, nil
		}
		return Layer{}, err
	}

	fi, err := os.Stat(blobPath)
	if err != nil {
		return Layer{}, err
	}
	layer.Size = fi.Size()
	layer.Status = fmt.Sprintf("using existing layer %s", digest)

	return layer, nil
}

func (l *Layer) Open() (io.ReadSeekCloser, error) {
	if l.Digest == "" {
		return nil, errors.New("opening layer with empty digest")
	}

	// Blobs may live in any models root (allpaca or ollama), so resolve
	// across roots instead of assuming the OLLAMA_MODELS root
	blobPath, err := FindBlobPath(l.Digest)
	if err != nil {
		return nil, err
	}

	return os.Open(blobPath)
}

func (l *Layer) Remove() error {
	if l.Digest == "" {
		return nil
	}

	// Ignore corrupt manifests to avoid blocking deletion of layers that are
	// freshly orphaned
	referenced, err := digestReferenced(l.Digest)
	if err != nil {
		return err
	}
	if referenced {
		// something is using this layer
		return nil
	}

	removeBlobEverywhere(l.Digest)

	return nil
}