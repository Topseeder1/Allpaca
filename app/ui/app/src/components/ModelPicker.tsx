import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  type JSX,
  useImperativeHandle,
} from "react";
import { Model } from "@/gotypes";
import { useSelectedModel } from "@/hooks/useSelectedModel";
import { usePullModel } from "@/hooks/usePullModel";
import { useQueryClient } from "@tanstack/react-query";
import { getModelUpstreamInfo } from "@/api";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";

const stalenessCheckCache = new Map<string, number>();

function OriginBadge({ origin }: { origin?: string }) {
  if (!origin) return null;

  const isAllpaca = origin === "allpaca";

  return (
    <span
      title={
        isAllpaca
          ? "From the Allpaca models directory"
          : "From the Ollama models directory"
      }
      className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wide ${
        isAllpaca
          ? "bg-accent/15 text-accent"
          : "bg-surface-hover text-fg-muted"
      }`}
    >
      {origin}
    </span>
  );
}

export const ModelPicker = forwardRef<
  HTMLButtonElement,
  {
    chatId?: string;
    onModelSelect?: () => void;
    onEscape?: () => void;
    onDropdownToggle?: (isOpen: boolean) => void;
    isDisabled?: boolean;
  }
>(function ModelPicker(
  { chatId, onModelSelect, onEscape, onDropdownToggle, isDisabled },
  ref,
): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { selectedModel, setSettings, models, loading } = useSelectedModel(
    chatId,
    searchQuery,
  );
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { pull, pulls, errors } = usePullModel();
  const modelListRef = useRef<{
    scrollToSelectedModel: () => void;
    scrollToTop: () => void;
  }>(null);

  // Cloud models cannot run in Allpaca: there are no local weights to
  // download, and the fork never signs in to ollama.com. Showing them in the
  // picker with a download arrow is a dead end, so they are dropped entirely.
  const localModels = models.filter((model) => !model.isCloud());

  const checkModelStaleness = async (model: Model) => {
    if (
      !model ||
      !model.model ||
      model.digest === undefined ||
      model.digest === ""
    )
      return;

    // Check cache - only check staleness every 5 minutes per model
    const now = Date.now();
    const lastChecked = stalenessCheckCache.get(model.model);
    if (lastChecked && now - lastChecked < 5 * 60 * 1000) return;
    stalenessCheckCache.set(model.model, now);

    try {
      const upstreamInfo = await getModelUpstreamInfo(model);

      // Compare local digest with upstream digest
      let isStale =
        model.digest &&
        upstreamInfo.digest &&
        model.digest !== upstreamInfo.digest;

      // If the model has a modified time and upstream has a push time,
      // check if the model was modified after the push time - if so, it's not stale
      if (isStale && model.modified_at && upstreamInfo.pushTime > 0) {
        const modifiedAtTime =
          new Date(model.modified_at as string | number | Date).getTime() /
          1000;
        if (modifiedAtTime > upstreamInfo.pushTime) {
          isStale = false;
        }
      }

      if (isStale) {
        const currentStaleModels =
          queryClient.getQueryData<Map<string, boolean>>(["staleModels"]) ||
          new Map();
        const newMap = new Map(currentStaleModels);
        newMap.set(model.model, true);
        queryClient.setQueryData(["staleModels"], newMap);
      }
    } catch (error) {
      console.error("Failed to check model staleness:", error);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (ref && typeof ref === "object" && ref.current) {
      (ref.current as any).closeDropdown = () => setIsOpen(false);
    }
  }, [ref, setIsOpen]);

  // Focus search when opened and refresh models
  // Clear search when closed
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
      modelListRef.current?.scrollToSelectedModel();
    } else {
      setSearchQuery("");
    }
  }, [isOpen]);

  // When searching, scroll to top of list
  useEffect(() => {
    if (searchQuery && modelListRef.current) {
      modelListRef.current.scrollToTop();
    }
  }, [searchQuery]);

  useEffect(() => {
    if (selectedModel && !loading) {
      checkModelStaleness(selectedModel);
    }
  }, [selectedModel?.model, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setIsOpen(false);
        onEscape?.();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onEscape]);

  const handleModelSelect = (model: Model) => {
    setSettings({ SelectedModel: model.model });
    setIsOpen(false);
    onModelSelect?.();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        ref={ref}
        type="button"
        title="Select model"
        onClick={() => {
          const newState = !isOpen;
          setIsOpen(newState);
          onDropdownToggle?.(newState);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const newState = !isOpen;
            setIsOpen(newState);
            onDropdownToggle?.(newState);
          }
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="flex items-center select-none gap-1.5 rounded-full px-3.5 py-1.5 bg-surface text-fg focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span>
            {isDisabled
              ? "Loading..."
              : selectedModel?.model || "Select a model"}
          </span>
        </div>
        <svg
          className="h-3 w-3 opacity-70"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute right-0 text-[15px] bottom-full mb-2 z-50 w-72 rounded-2xl overflow-hidden bg-surface-raised border border-border text-fg shadow-xl shadow-black/5 backdrop-blur-lg dark:ring-black/20">
          <div className="px-1 py-2 border-b border-border">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Find model..."
              autoCorrect="off"
              className="w-full px-2 py-0.5 bg-transparent border-none border-border rounded-md outline-none focus:border-fg/25"
            />
          </div>

          <ModelList
            ref={modelListRef}
            models={localModels}
            selectedModel={selectedModel}
            onModelSelect={handleModelSelect}
            isOpen={isOpen}
            pulls={pulls}
            errors={errors}
            onPull={pull}
          />
        </div>
      )}
    </div>
  );
});

export const ModelList = forwardRef(function ModelList(
  {
    models,
    selectedModel,
    onModelSelect,
    isOpen,
    pulls,
    errors,
    onPull,
  }: {
    models: Model[];
    selectedModel: Model | null;
    onModelSelect: (model: Model) => void;
    isOpen: boolean;
    pulls: Record<string, import("@/hooks/usePullModel").PullProgress>;
    errors: Record<string, string>;
    onPull: (modelName: string) => void;
  },
  ref,
): JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useImperativeHandle(ref, () => ({
    scrollToSelectedModel: () => {
      if (!selectedModel || !scrollContainerRef.current) return;
      const selectedIndex = models.findIndex(
        (m) => m.model === selectedModel.model,
      );
      if (selectedIndex !== -1) scrollToItem(selectedIndex);
    },
    scrollToTop: () => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    },
  }));

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen || models.length === 0) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          setHighlightedIndex((prev) => {
            const next = prev < models.length - 1 ? prev + 1 : 0;
            scrollToItem(next);
            return next;
          });
          break;
        case "ArrowUp":
          event.preventDefault();
          setHighlightedIndex((prev) => {
            const next = prev > 0 ? prev - 1 : models.length - 1;
            scrollToItem(next);
            return next;
          });
          break;
        case "Enter":
          event.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < models.length) {
            onModelSelect(models[highlightedIndex]);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, models, highlightedIndex, onModelSelect]);

  // Scroll active item into view
  const scrollToItem = (index: number) => {
    if (scrollContainerRef.current && index >= 0) {
      const container = scrollContainerRef.current;
      const item = container.children[index] as HTMLElement;
      if (item) {
        // Calculate the exact scroll position to center the item
        const containerHeight = container.clientHeight;
        const itemTop = item.offsetTop;
        const itemHeight = item.clientHeight;
        // Position the item in the center of the container
        container.scrollTop = itemTop - containerHeight / 2 + itemHeight / 2;
      }
    }
  };

  return (
    <div
      ref={scrollContainerRef}
      className="h-64 overflow-y-auto overflow-x-hidden"
    >
      {models.length === 0 ? (
        <div className="px-3 py-2 text-fg-muted">No models found</div>
      ) : (
        models.map((model, index) => {
          const progress = pulls[model.model];
          const error = errors[model.model];
          const isPulling = progress !== undefined;
          // Only models that aren't on disk get a download control.
          const needsDownload = model.digest === undefined;

          return (
            <div
              key={`${model.model}-${model.digest || "no-digest"}-${index}`}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`flex w-full items-center hover:bg-surface-hover ${
                highlightedIndex === index ||
                selectedModel?.model === model.model
                  ? "bg-surface-hover"
                  : ""
              }`}
            >
              <button
                onClick={() => onModelSelect(model)}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left focus:outline-none cursor-pointer"
              >
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate">{model.model}</span>
                  <OriginBadge origin={model.origin} />
                </span>
              </button>

              {needsDownload && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onPull(model.model);
                  }}
                  disabled={isPulling}
                  title={
                    isPulling
                      ? progress.status === "downloading"
                        ? `Downloading ${progress.percent.toFixed(0)}%`
                        : progress.status
                      : "Download this model now"
                  }
                  aria-label={
                    isPulling ? "Downloading model" : "Download this model"
                  }
                  className="mr-2 flex h-6 shrink-0 items-center justify-center rounded-md px-1.5 text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-default disabled:opacity-70"
                >
                  {isPulling ? (
                    <span className="text-[11px] tabular-nums">
                      {progress.total > 0
                        ? `${Math.round(progress.percent)}%`
                        : "…"}
                    </span>
                  ) : (
                    <ArrowDownTrayIcon
                      className="h-4 w-4"
                      strokeWidth={1.75}
                    />
                  )}
                </button>
              )}

              {error && (
                <span
                  title={error}
                  className="mr-2 shrink-0 text-[11px] text-red-500"
                >
                  !
                </span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
});