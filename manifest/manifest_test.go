package manifest

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ollama/ollama/types/model"
)

const testModelName = "test.local/allpaca/m:latest"

func writeTestManifest(t *testing.T, root string, configDigest string) {
	t.Helper()

	n := model.ParseName(testModelName)
	if !n.IsValid() {
		t.Fatalf("invalid test model name: %s", testModelName)
	}

	mPath, _, err := parseModelPathIn(root, n.Path())
	if err != nil {
		t.Fatalf("parseModelPathIn: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(mPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}

	m := Manifest{
		SchemaVersion: 2,
		MediaType:     "application/vnd.docker.distribution.manifest.v2+json",
		Config: Layer{
			MediaType: "application/vnd.ollama.image.model",
			Digest:    configDigest,
			Size:      1,
		},
	}

	b, err := json.Marshal(m)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}

	if err := os.WriteFile(mPath, b, 0o644); err != nil {
		t.Fatalf("write manifest: %v", err)
	}
}

func writeTestBlob(t *testing.T, root, digest string, content []byte) {
	t.Helper()

	dir := filepath.Join(root, "blobs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir blobs: %v", err)
	}

	if err := os.WriteFile(filepath.Join(dir, digest), content, 0o644); err != nil {
		t.Fatalf("write blob: %v", err)
	}
}

func TestModelRootsPrecedence(t *testing.T) {
	allpacaDir := t.TempDir()
	ollamaDir := t.TempDir()

	t.Setenv("ALLPACA_MODELS", allpacaDir)
	t.Setenv("OLLAMA_MODELS", ollamaDir)

	roots := modelRoots()
	if len(roots) != 2 {
		t.Fatalf("len(roots) = %d, want 2", len(roots))
	}
	if roots[0].dir != allpacaDir || roots[0].origin != OriginAllpaca {
		t.Fatalf("roots[0] = %+v, want allpaca dir first", roots[0])
	}
	if roots[1].dir != ollamaDir || roots[1].origin != OriginOllama {
		t.Fatalf("roots[1] = %+v, want ollama dir second", roots[1])
	}

	// Same directory for both vars must collapse to a single root
	t.Setenv("OLLAMA_MODELS", allpacaDir)
	roots = modelRoots()
	if len(roots) != 1 {
		t.Fatalf("len(roots) = %d, want 1 when dirs are equal", len(roots))
	}
}

func TestDualDirManifestResolution(t *testing.T) {
	allpacaDir := t.TempDir()
	ollamaDir := t.TempDir()

	t.Setenv("ALLPACA_MODELS", allpacaDir)
	t.Setenv("OLLAMA_MODELS", ollamaDir)

	n := model.ParseName(testModelName)
	if !n.IsValid() {
		t.Fatalf("invalid test model name: %s", testModelName)
	}

	// Both roots carry the same model name with different config digests:
	// the Allpaca root must win
	writeTestManifest(t, allpacaDir, "sha256-allpaca")
	writeTestManifest(t, ollamaDir, "sha256-ollama")

	m, origin, err := ParseNamedManifestWithOrigin(n)
	if err != nil {
		t.Fatalf("ParseNamedManifestWithOrigin: %v", err)
	}
	if origin != OriginAllpaca {
		t.Fatalf("origin = %q, want %q", origin, OriginAllpaca)
	}
	if m.Config.Digest != "sha256-allpaca" {
		t.Fatalf("digest = %q, want allpaca copy to win the collision", m.Config.Digest)
	}

	// Plain ParseNamedManifest must resolve the same winning copy
	m2, err := ParseNamedManifest(n)
	if err != nil {
		t.Fatalf("ParseNamedManifest: %v", err)
	}
	if m2.Config.Digest != "sha256-allpaca" {
		t.Fatalf("digest = %q, want allpaca copy", m2.Config.Digest)
	}

	// ManifestOrigin agrees with the explicit variant
	got, err := ManifestOrigin(testModelName)
	if err != nil {
		t.Fatalf("ManifestOrigin: %v", err)
	}
	if got != OriginAllpaca {
		t.Fatalf("ManifestOrigin = %q, want %q", got, OriginAllpaca)
	}

	// Removing the Allpaca copy falls through to the Ollama root
	allpacaPath, _, err := parseModelPathIn(allpacaDir, n.Path())
	if err != nil {
		t.Fatalf("parseModelPathIn: %v", err)
	}
	if err := os.Remove(allpacaPath); err != nil {
		t.Fatalf("remove allpaca manifest: %v", err)
	}

	m, origin, err = ParseNamedManifestWithOrigin(n)
	if err != nil {
		t.Fatalf("ParseNamedManifestWithOrigin after fallthrough: %v", err)
	}
	if origin != OriginOllama {
		t.Fatalf("origin = %q, want %q", origin, OriginOllama)
	}
	if m.Config.Digest != "sha256-ollama" {
		t.Fatalf("digest = %q, want ollama copy after fallthrough", m.Config.Digest)
	}

	// RemoveNamedManifest clears every root in one call
	if err := RemoveNamedManifest(testModelName); err != nil {
		t.Fatalf("RemoveNamedManifest: %v", err)
	}

	if _, err := ParseNamedManifest(n); !errors.Is(err, ErrManifestNotFound) {
		t.Fatalf("err = %v, want ErrManifestNotFound", err)
	}

	ollamaPath, _, err := parseModelPathIn(ollamaDir, n.Path())
	if err != nil {
		t.Fatalf("parseModelPathIn: %v", err)
	}
	if _, statErr := os.Stat(ollamaPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("ollama manifest still present after RemoveNamedManifest")
	}

	// Removing a nonexistent model reports ErrManifestNotFound
	if err := RemoveNamedManifest(testModelName); !errors.Is(err, ErrManifestNotFound) {
		t.Fatalf("err = %v, want ErrManifestNotFound", err)
	}
}

func TestNewLayerFromLayerDualDir(t *testing.T) {
	allpacaDir := t.TempDir()
	ollamaDir := t.TempDir()

	t.Setenv("ALLPACA_MODELS", allpacaDir)
	t.Setenv("OLLAMA_MODELS", ollamaDir)

	digest := "sha256-" + strings.Repeat("ab", 32)

	// Blob only in the Ollama root
	writeTestBlob(t, ollamaDir, digest, []byte("ollama blob"))
	l, err := NewLayerFromLayer(digest, "application/vnd.ollama.image.model", "test")
	if err != nil {
		t.Fatalf("NewLayerFromLayer: %v", err)
	}
	if l.Size != int64(len("ollama blob")) {
		t.Fatalf("size = %d, want %d", l.Size, len("ollama blob"))
	}

	// Same digest appears in the Allpaca root: Allpaca wins
	writeTestBlob(t, allpacaDir, digest, []byte("allpaca"))
	l, err = NewLayerFromLayer(digest, "application/vnd.ollama.image.model", "test")
	if err != nil {
		t.Fatalf("NewLayerFromLayer: %v", err)
	}
	if l.Size != int64(len("allpaca")) {
		t.Fatalf("size = %d, want allpaca copy to win", l.Size)
	}

	path, err := FindBlobPath(digest)
	if err != nil {
		t.Fatalf("FindBlobPath: %v", err)
	}
	if !strings.HasPrefix(path, allpacaDir) {
		t.Fatalf("FindBlobPath = %q, want path under allpaca dir", path)
	}

	// Unknown digest keeps Size -1 with no error (prior behavior)
	missing := "sha256-" + strings.Repeat("cd", 32)
	l, err = NewLayerFromLayer(missing, "application/vnd.ollama.image.model", "test")
	if err != nil {
		t.Fatalf("NewLayerFromLayer missing digest: %v", err)
	}
	if l.Size != -1 {
		t.Fatalf("size = %d, want -1 for missing blob", l.Size)
	}
}

func TestBlobsFromDiskDualDir(t *testing.T) {
	allpacaDir := t.TempDir()
	ollamaDir := t.TempDir()

	t.Setenv("ALLPACA_MODELS", allpacaDir)
	t.Setenv("OLLAMA_MODELS", ollamaDir)

	digest := "sha256-" + strings.Repeat("ef", 32)

	layerJSON := func(size int64) string {
		l := Layer{MediaType: "application/vnd.ollama.image.model", Digest: digest, Size: size}
		b, err := json.Marshal(l)
		if err != nil {
			t.Fatalf("marshal layer: %v", err)
		}
		return string(b)
	}

	writeTestBlob(t, allpacaDir, digest, []byte(layerJSON(111)))
	writeTestBlob(t, ollamaDir, digest, []byte(layerJSON(222)))

	blobs, err := blobsFromDisk()
	if err != nil {
		t.Fatalf("blobsFromDisk: %v", err)
	}

	got, ok := blobs[digest]
	if !ok {
		t.Fatalf("digest %s missing from blobsFromDisk result", digest)
	}
	if got.Size != 111 {
		t.Fatalf("size = %d, want 111 (allpaca copy wins dedupe)", got.Size)
	}
	if len(blobs) != 1 {
		t.Fatalf("len(blobs) = %d, want 1 (duplicate digest deduped)", len(blobs))
	}
}