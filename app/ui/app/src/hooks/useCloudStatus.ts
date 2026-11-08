/**
 * Cloud status for the current build.
 *
 * Upstream Ollama gates "stale model" warnings on whether cloud models are
 * usable (see useShouldShowStaleDisplay in useChats.ts). This fork has no
 * separate cloud-disable switch, so cloud is treated as always enabled and
 * `cloudDisabled` is a constant false. If airplane mode or a fork-level cloud
 * toggle is introduced later, derive the flag from that source here — this is
 * the single seam every consumer reads from.
 */
export function useCloudStatus(): { cloudDisabled: boolean } {
  return { cloudDisabled: false };
}