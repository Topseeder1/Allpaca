package manifest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/topseeder1/allpaca/envconfig"
	"github.com/topseeder1/allpaca/types/model"
)

// Manifest is the on-disk manifest for a model. Layer is defined in layer.go;
// Path/BlobsPath helpers live in paths.go.
type Manifest struct {
	SchemaVersion int     `json:"schemaVersion"`
	MediaType     string  `json:"mediaType"`
	Config        Layer   `json:"config"`
	Layers        []Layer `json:"layers"`

	filepath string
	fi       os.FileInfo
	digest   string

	// origin records which models root this manifest was read from. It is set
	// by resolveManifest and never encoded/decoded to disk (unexported).
	// Surfaced via the Origin accessor so /api/tags can badge models by source.
	origin Origin
}

// Origin identifies which models directory a model resolved from. It is
// surfaced by /api/tags so the UI can badge models by source.
type Origin string

const (
	OriginAllpaca Origin = "allpaca"
	OriginOllama  Origin = "ollama"
)

type modelRoot struct {
	dir    string
	origin Origin
}

// modelRoots returns the model directories to search, in precedence order:
// ALLPACA_MODELS first (Allpaca wins name collisions), then OLLAMA_MODELS.
func modelRoots() []modelRoot {
	allpaca := envconfig.AllpacaModels()
	roots := []modelRoot{{dir: allpaca, origin: OriginAllpaca}}

	ollama := envconfig.Models()
	if ollama != allpaca {
		roots = append(roots, modelRoot{dir: ollama, origin: OriginOllama})
	}

	return roots
}

// parseModelPathIn builds the manifest file path and blobs directory for a
// model under the given models root. Layout is
// <root>/manifests/<host>/<namespace>/<model>/<tag>. model.Path is a plain
// struct with no path method, so the relative path is assembled from its fields.
func parseModelPathIn(root string, mp model.Path) (manifestPath, blobsDir string, err error) {
	blobsDir = filepath.Join(root, "blobs")

	parts := []string{root, "manifests"}
	if mp.Host != "" {
		parts = append(parts, mp.Host)
	}
	parts = append(parts, mp.Namespace, mp.Model, mp.Tag)

	return filepath.Join(parts...), blobsDir, nil
}

// parseModelPath resolves against the Ollama models directory. It is used by
// write paths, which remain rooted in OLLAMA_MODELS for v1; read paths resolve
// across all roots via resolveManifest.
func parseModelPath(mp model.Path) (manifestPath, blobsDir string, err error) {
	return parseModelPathIn(envconfig.Models(), mp)
}

// ErrManifestNotFound is returned when a manifest or blob cannot be located in
// any model root. It wraps os.ErrNotExist so callers that only need to know
// "not present" (e.g. the pull fallback in server/model.go) keep working.
var ErrManifestNotFound = fmt.Errorf("manifest not found: %w", os.ErrNotExist)

// blobFileName normalizes a sha256 digest ("sha256:<hex>") to the on-disk blob
// filename ("sha256-<hex>"), matching paths.BlobsPath.
func blobFileName(digest string) string {
	return strings.ReplaceAll(digest, ":", "-")
}

// resolveManifest finds a named manifest across all model roots, in precedence
// order (Allpaca first, then Ollama), and populates Manifest's private
// filepath/fi/digest/origin from the winning copy.
func resolveManifest(n model.Name) (*Manifest, modelRoot, error) {
	if !n.IsFullyQualified() {
		return nil, modelRoot{}, model.Unqualified(n)
	}

	for _, root := range modelRoots() {
		p, _, err := parseModelPathIn(root.dir, n.Path())
		if err != nil {
			return nil, root, err
		}

		f, err := os.Open(p)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, root, err
		}

		fi, err := f.Stat()
		if err != nil {
			f.Close()
			return nil, root, err
		}

		var m Manifest
		sha256sum := sha256.New()
		if err := json.NewDecoder(io.TeeReader(f, sha256sum)).Decode(&m); err != nil {
			f.Close()
			return nil, root, err
		}
		f.Close()

		m.filepath = p
		m.fi = fi
		m.digest = hex.EncodeToString(sha256sum.Sum(nil))
		m.origin = root.origin

		return &m, root, nil
	}

	return nil, modelRoot{}, ErrManifestNotFound
}

// Origin reports which models directory this manifest was read from. Returns
// the zero value if the manifest was not produced by resolveManifest (e.g. a
// Manifest constructed in-memory). Used by /api/tags to badge models.
func (m *Manifest) Origin() Origin {
	return m.origin
}

func (m *Manifest) Size() (size int64) {
	for _, layer := range append(m.Layers, m.Config) {
		size += layer.Size
	}
	return
}

func (m *Manifest) Digest() string {
	return m.digest
}

func (m *Manifest) FileInfo() os.FileInfo {
	return m.fi
}

// ReadConfigJSON reads and unmarshals a config layer as JSON. The underlying
// blob is resolved across all model roots.
func (m *Manifest) ReadConfigJSON(configPath string, v any) error {
	for _, layer := range m.Layers {
		if layer.MediaType == "application/vnd.ollama.image.json" && layer.Name == configPath {
			blobPath, err := FindBlobPath(layer.Digest)
			if err != nil {
				return err
			}
			data, err := os.ReadFile(blobPath)
			if err != nil {
				return err
			}
			return json.Unmarshal(data, v)
		}
	}
	return fmt.Errorf("config %q not found in manifest", configPath)
}

func (m *Manifest) Remove() error {
	if err := os.Remove(m.filepath); err != nil {
		return err
	}

	// Prune every root's manifests tree so the empty parent directories left by
	// this removal are cleaned up regardless of which root it lived in.
	for _, root := range modelRoots() {
		manifests := filepath.Join(root.dir, "manifests")
		if err := PruneDirectory(manifests); err != nil {
			return err
		}
	}

	return nil
}

func (m *Manifest) RemoveLayers() error {
	ms, err := Manifests(true)
	if err != nil {
		return err
	}

	// Build set of digests still in use by other manifests
	inUse := make(map[string]struct{})
	for _, other := range ms {
		for _, layer := range append(other.Layers, other.Config) {
			if layer.Digest != "" {
				inUse[layer.Digest] = struct{}{}
			}
		}
	}

	// Remove layers not used by any other manifest
	for _, layer := range append(m.Layers, m.Config) {
		if layer.Digest == "" {
			continue
		}
		if _, used := inUse[layer.Digest]; used {
			continue
		}
		blob, err := FindBlobPath(layer.Digest)
		if err != nil {
			if errors.Is(err, ErrManifestNotFound) {
				slog.Debug("layer does not exist", "digest", layer.Digest)
				continue
			}
			return err
		}
		if err := os.Remove(blob); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}

	return nil
}

func ParseNamedManifest(n model.Name) (*Manifest, error) {
	m, _, err := resolveManifest(n)
	return m, err
}

// ParseNamedManifestWithOrigin behaves like ParseNamedManifest but also reports
// which models directory the manifest resolved from.
func ParseNamedManifestWithOrigin(n model.Name) (*Manifest, Origin, error) {
	m, root, err := resolveManifest(n)
	if err != nil {
		return nil, "", err
	}
	return m, root.origin, nil
}

// ManifestOrigin reports which models directory the named model resolves from.
func ManifestOrigin(name string) (Origin, error) {
	n := model.ParseName(name)
	if !n.IsValid() {
		return "", model.ErrInvalidModelName
	}

	_, root, err := resolveManifest(n)
	if err != nil {
		return "", err
	}

	return root.origin, nil
}

// RemoveNamedManifest removes the named manifest from every model root where it
// exists. Returns ErrManifestNotFound if no root contained it.
func RemoveNamedManifest(name string) error {
	n := model.ParseName(name)
	if !n.IsValid() {
		return model.ErrInvalidModelName
	}
	return removeNamed(n)
}

func removeNamed(n model.Name) error {
	removed := false
	for _, root := range modelRoots() {
		p, _, err := parseModelPathIn(root.dir, n.Path())
		if err != nil {
			return err
		}

		if err := os.Remove(p); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return err
		}
		removed = true
	}

	if !removed {
		return ErrManifestNotFound
	}
	return nil
}

func WriteManifest(name model.Name, config Layer, layers []Layer) error {
	manifests, err := Path()
	if err != nil {
		return err
	}

	p := filepath.Join(manifests, name.Filepath())
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}

	f, err := os.Create(p)
	if err != nil {
		return err
	}
	defer f.Close()

	m := Manifest{
		SchemaVersion: 2,
		MediaType:     "application/vnd.docker.distribution.manifest.v2+json",
		Config:        config,
		Layers:        layers,
	}

	return json.NewEncoder(f).Encode(m)
}

// Manifests returns every manifest across all model roots, keyed by name. On a
// name collision the first root (Allpaca) wins. continueOnError controls
// whether a bad file aborts the scan or is logged and skipped. Every returned
// Manifest carries its origin (see Manifest.Origin).
func Manifests(continueOnError bool) (map[model.Name]*Manifest, error) {
	ms := make(map[model.Name]*Manifest)

	for _, root := range modelRoots() {
		manifests := filepath.Join(root.dir, "manifests")

		matches, err := filepath.Glob(filepath.Join(manifests, "*", "*", "*", "*"))
		if err != nil {
			return nil, err
		}

		for _, match := range matches {
			fi, err := os.Stat(match)
			if err != nil {
				if !continueOnError {
					return nil, err
				}
				slog.Warn("bad manifest path", "path", match, "error", err)
				continue
			}

			if fi.IsDir() {
				continue
			}

			rel, err := filepath.Rel(manifests, match)
			if err != nil {
				if !continueOnError {
					return nil, fmt.Errorf("%s %w", match, err)
				}
				slog.Warn("bad filepath", "path", match, "error", err)
				continue
			}

			n := model.ParseNameFromFilepath(rel)
			if !n.IsValid() {
				if !continueOnError {
					return nil, model.ErrInvalidModelName
				}
				slog.Warn("bad manifest name", "path", rel)
				continue
			}

			if _, ok := ms[n]; ok {
				// Duplicate across roots: the first root (Allpaca) wins
				continue
			}

			m, err := ParseNamedManifest(n)
			if err != nil {
				if !continueOnError {
					return nil, fmt.Errorf("%s %w", n, err)
				}
				slog.Warn("bad manifest", "name", n, "error", err)
				continue
			}

			ms[n] = m
		}
	}

	return ms, nil
}

// FindBlobPath returns the path of a blob across all model roots, in
// precedence order. The digest is normalised to the on-disk filename form
// ("sha256:<hex>" -> "sha256-<hex>") before lookup.
func FindBlobPath(digest string) (string, error) {
	name := blobFileName(digest)

	for _, root := range modelRoots() {
		blobPath := filepath.Join(root.dir, "blobs", name)
		fi, err := os.Stat(blobPath)
		switch {
		case errors.Is(err, os.ErrNotExist):
			// try the next root
		case err != nil:
			return "", err
		case fi.IsDir():
			// try the next root
		default:
			return blobPath, nil
		}
	}

	return "", fmt.Errorf("%w: %s", ErrManifestNotFound, digest)
}

// digestReferenced reports whether any manifest across every models root still
// references the given digest. Used by Layer.Remove to decide if a blob is
// orphaned.
func digestReferenced(digest string) (bool, error) {
	want := blobFileName(digest)

	for _, root := range modelRoots() {
		manifests := filepath.Join(root.dir, "manifests")

		matches, err := filepath.Glob(filepath.Join(manifests, "*", "*", "*", "*"))
		if err != nil {
			return false, err
		}

		for _, match := range matches {
			fi, err := os.Stat(match)
			if err != nil || fi.IsDir() {
				continue
			}

			f, err := os.Open(match)
			if err != nil {
				continue
			}

			var m Manifest
			derr := json.NewDecoder(f).Decode(&m)
			f.Close()
			if derr != nil {
				// ignore corrupt manifests so deletions aren't blocked by one
				// bad file
				continue
			}

			if blobFileName(m.Config.Digest) == want {
				return true, nil
			}
			for _, l := range m.Layers {
				if blobFileName(l.Digest) == want {
					return true, nil
				}
			}
		}
	}

	return false, nil
}

// removeBlobEverywhere removes a blob from every models root, best-effort.
func removeBlobEverywhere(digest string) {
	name := blobFileName(digest)
	for _, root := range modelRoots() {
		blobPath := filepath.Join(root.dir, "blobs", name)
		if err := os.Remove(blobPath); err != nil && !errors.Is(err, os.ErrNotExist) {
			slog.Debug("failed to remove blob", "digest", digest, "path", blobPath, "error", err)
		}
	}
}

// blobsFromDisk scans every model root's blobs directory. Duplicate digests
// across roots are deduped with the first root (Allpaca) winning.
func blobsFromDisk() (map[string]*Layer, error) {
	blobs := make(map[string]*Layer)

	for _, root := range modelRoots() {
		dir := filepath.Join(root.dir, "blobs")

		matches, err := filepath.Glob(filepath.Join(dir, "sha256-*"))
		if err != nil {
			return nil, err
		}

		for _, match := range matches {
			fp, err := os.Open(match)
			if err != nil {
				return nil, err
			}

			dec := json.NewDecoder(fp)
			var layer Layer
			derr := dec.Decode(&layer)
			fp.Close()
			if errors.Is(derr, io.EOF) {
				continue
			}
			if derr != nil {
				return nil, derr
			}

			digest := filepath.Base(match)
			if _, ok := blobs[digest]; ok {
				continue
			}

			blobs[digest] = &layer
		}
	}

	return blobs, nil
}