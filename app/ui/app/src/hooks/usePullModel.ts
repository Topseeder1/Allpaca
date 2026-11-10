import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/config";

export interface PullProgress {
  /** Status string from the server ("pulling manifest", "downloading", ...). */
  status: string;
  /** Aggregate bytes downloaded across all layers. */
  completed: number;
  /** Aggregate bytes total across all layers. 0 until the first size arrives. */
  total: number;
  /** completed/total clamped to 0-100. 0 when total is unknown. */
  percent: number;
}

/** Split an NDJSON stream buffer into complete lines plus the leftover tail. */
function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim() !== ""), rest };
}

/**
 * Pulls a model from the registry and streams progress.
 *
 * The download icon in ModelPicker calls `pull(name)`. Progress is tracked per
 * model in `pulls`; errors are tracked per model in `errors`. On success the
 * ["models"] query is invalidated so the freshly-downloaded model comes back
 * from /api/tags with a digest and the download arrow disappears.
 *
 * The server endpoint is Ollama's native `POST /api/pull`, which the UI server
 * proxies through to the inference server. It is public — no sign-in — and
 * requires the route to be registered in app/ui/ui.go (see notes).
 */
export function usePullModel() {
  const queryClient = useQueryClient();
  const [pulls, setPulls] = useState<Record<string, PullProgress>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const clearError = useCallback((modelName: string) => {
    setErrors((prev) => {
      if (!(modelName in prev)) return prev;
      const next = { ...prev };
      delete next[modelName];
      return next;
    });
  }, []);

  const pull = useCallback(
    async (modelName: string) => {
      if (inFlight.current.has(modelName)) return;
      inFlight.current.add(modelName);
      clearError(modelName);

      // Per-digest byte counters. A model is many layers; the aggregate bar
      // has to reflect all of them, not whichever one reported last.
      const layerTotal = new Map<string, number>();
      const layerDone = new Map<string, number>();

      const publish = (status: string) => {
        let total = 0;
        let completed = 0;
        for (const [digest, t] of layerTotal) {
          total += t;
          completed += Math.min(layerDone.get(digest) ?? 0, t);
        }
        const percent =
          total > 0 ? Math.min(100, (completed / total) * 100) : 0;
        setPulls((prev) => ({
          ...prev,
          [modelName]: { status, completed, total, percent },
        }));
      };

      publish("starting");

      try {
        const response = await fetch(`${API_BASE}/api/pull`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelName, stream: true }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || `${response.status} ${response.statusText}`);
        }
        if (!response.body) {
          throw new Error("streaming not supported");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { lines, rest } = splitLines(buffer);
          buffer = rest;

          for (const line of lines) {
            let event: {
              error?: string;
              status?: string;
              digest?: string;
              total?: number;
              completed?: number;
            };
            try {
              event = JSON.parse(line);
            } catch {
              continue;
            }

            if (event.error) {
              throw new Error(event.error);
            }

            if (
              event.digest &&
              typeof event.total === "number" &&
              event.total > 0
            ) {
              layerTotal.set(event.digest, event.total);
            }
            if (event.digest && typeof event.completed === "number") {
              layerDone.set(event.digest, event.completed);
            }

            publish(event.status ?? "downloading");
          }
        }

        // Fresh digest for this model now exists on disk; refresh the list so
        // the download arrow goes away.
        await queryClient.invalidateQueries({ queryKey: ["models"] });

        setPulls((prev) => {
          const next = { ...prev };
          delete next[modelName];
          return next;
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setErrors((prev) => ({ ...prev, [modelName]: message }));
        setPulls((prev) => {
          const next = { ...prev };
          delete next[modelName];
          return next;
        });
      } finally {
        inFlight.current.delete(modelName);
      }
    },
    [queryClient, clearError],
  );

  return { pull, pulls, errors, clearError };
}