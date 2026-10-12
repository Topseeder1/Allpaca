import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { Field, Label, Description } from "@/components/ui/fieldset";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  type SelectOption,
  type SelectSwatch,
} from "@/components/ui/select";
import {
  WifiIcon,
  FolderIcon,
  BoltIcon,
  WrenchIcon,
  CogIcon,
  ArrowPathIcon,
} from "@heroicons/react/20/solid";
import { Settings as SettingsType } from "@/gotypes";
import { useUser } from "@/hooks/useUser";
import {
  getTheme,
  getFont,
  setTheme,
  setFont,
  resolveThemeName,
  THEME_OPTIONS,
  FONT_OPTIONS,
  DEFAULT_THEME,
  DEFAULT_FONT,
  type ThemeValue,
  type FontValue,
} from "@/lib/appearance";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSettings, updateSettings } from "@/api";

function AnimatedDots() {
  return (
    <span className="inline-flex">
      <span className="animate-pulse">.</span>
      <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>
        .
      </span>
      <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>
        .
      </span>
    </span>
  );
}

const savedConfirmationDuration = 3000;

export default function Settings() {
  const queryClient = useQueryClient();
  const [showSaved, setShowSaved] = useState(false);
  const [restartMessage, setRestartMessage] = useState(false);
  const [resettingToDefaults, setResettingToDefaults] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const savedConfirmationTimeoutRef = useRef<number | null>(null);
  const [theme, setThemeState] = useState<ThemeValue>(() => getTheme());
  const [font, setFontState] = useState<FontValue>(() => getFont());
  const [themeSwatches, setThemeSwatches] = useState<
    Record<string, SelectSwatch>
  >({});
  const themeProbesRef = useRef<HTMLDivElement>(null);

  const {
    user,
    isAuthenticated,
    refreshUser,
    isRefreshing,
    fetchConnectUrl,
    isLoading,
    disconnectUser,
  } = useUser();
  const [isAwaitingConnection, setIsAwaitingConnection] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState<number | null>(null);

  const showSavedConfirmation = useCallback(() => {
    if (savedConfirmationTimeoutRef.current !== null) {
      window.clearTimeout(savedConfirmationTimeoutRef.current);
    }
    setShowSaved(true);
    savedConfirmationTimeoutRef.current = window.setTimeout(() => {
      setShowSaved(false);
      savedConfirmationTimeoutRef.current = null;
    }, savedConfirmationDuration);
  }, []);

  useEffect(
    () => () => {
      if (savedConfirmationTimeoutRef.current !== null) {
        window.clearTimeout(savedConfirmationTimeoutRef.current);
      }
    },
    [],
  );

  const {
    data: settingsData,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });

  const settings = settingsData?.settings || null;

  const updateSettingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  // Read each theme's surface/fg/accent from hidden probe elements so the
  // Theme dropdown can show swatches for themes that are NOT currently
  // active. Zero hex duplication — the CSS files remain the single source.
  useEffect(() => {
    const container = themeProbesRef.current;
    if (!container) return;
    const next: Record<string, SelectSwatch> = {};
    container
      .querySelectorAll<HTMLElement>("[data-probe-key]")
      .forEach((el) => {
        const key = el.dataset.probeKey;
        if (!key) return;
        const cs = getComputedStyle(el);
        next[key] = {
          surface: cs.getPropertyValue("--color-surface").trim(),
          fg: cs.getPropertyValue("--color-fg").trim(),
          accent: cs.getPropertyValue("--color-accent").trim(),
        };
      });
    setThemeSwatches(next);
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      if (isAwaitingConnection && pollingInterval) {
        // Stop polling when window gets focus
        clearInterval(pollingInterval);
        setPollingInterval(null);
        // Reset awaiting connection state
        setIsAwaitingConnection(false);
        // Make one last refresh request
        refreshUser();
      }
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [isAwaitingConnection, refreshUser, pollingInterval]);

  // Check if user is authenticated after refresh
  useEffect(() => {
    if (isAwaitingConnection && isAuthenticated) {
      setIsAwaitingConnection(false);
      setConnectionError(null);
      if (pollingInterval) {
        clearInterval(pollingInterval);
        setPollingInterval(null);
      }
    }
  }, [isAuthenticated, isAwaitingConnection, pollingInterval]);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [pollingInterval]);

  const handleChange = useCallback(
    (field: keyof SettingsType, value: boolean | string | number) => {
      if (settings) {
        const updatedSettings = new SettingsType({
          ...settings,
          [field]: value,
        });

        // If context length is being changed, show restart message
        if (field === "ContextLength" && value !== settings.ContextLength) {
          setRestartMessage(true);
          // Hide restart message after 3 seconds
          window.setTimeout(
            () => setRestartMessage(false),
            savedConfirmationDuration,
          );
        }

        updateSettingsMutation.mutate(updatedSettings, {
          onSuccess: showSavedConfirmation,
        });
      }
    },
    [settings, showSavedConfirmation, updateSettingsMutation],
  );

  const handleThemeChange = useCallback(
    (value: ThemeValue) => {
      setTheme(value); // writes localStorage + <html data-theme[-scheme]>
      setThemeState(value);
      showSavedConfirmation();
    },
    [showSavedConfirmation],
  );

  const handleFontChange = useCallback(
    (value: FontValue) => {
      setFont(value); // writes localStorage + <html data-font>
      setFontState(value);
      showSavedConfirmation();
    },
    [showSavedConfirmation],
  );

  const themeSelectOptions = useMemo<SelectOption<ThemeValue>[]>(
    () =>
      THEME_OPTIONS.map((opt) => ({
        value: opt.value,
        label: opt.label,
        swatch: themeSwatches[opt.value],
      })),
    [themeSwatches],
  );

  const fontSelectOptions = useMemo<SelectOption<FontValue>[]>(
    () => FONT_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label })),
    [],
  );

  const handleResetToDefaults = async () => {
    if (!settings || resettingToDefaults) return;

    // Appearance is local-only — reset synchronously, before any async work,
    // so a later network failure can't leave the UI half-reset.
    setTheme(DEFAULT_THEME);
    setThemeState(DEFAULT_THEME);
    setFont(DEFAULT_FONT);
    setFontState(DEFAULT_FONT);

    setResettingToDefaults(true);
    if (savedConfirmationTimeoutRef.current !== null) {
      window.clearTimeout(savedConfirmationTimeoutRef.current);
      savedConfirmationTimeoutRef.current = null;
    }
    setShowSaved(false);
    setRestartMessage(false);
    setResetError(null);
    try {
      await updateSettingsMutation.mutateAsync(
        new SettingsType({
          ...settings,
          Expose: false,
          Models: "",
          Agent: false,
          Tools: false,
        }),
      );
      showSavedConfirmation();
    } catch (error) {
      console.error("Failed to reset settings:", error);
      setResetError(
        "Ollama could not reset every setting. Check the settings above and try again.",
      );
    } finally {
      setResettingToDefaults(false);
    }
  };

  const handleConnectOllamaAccount = async () => {
    setConnectionError(null);

    // If user is already authenticated, no need to connect
    if (isAuthenticated) {
      return;
    }

    try {
      // If we don't have a user or user has no name, get connect URL
      if (!user || !user?.name) {
        const { data: connectUrl } = await fetchConnectUrl();
        if (connectUrl) {
          window.open(connectUrl, "_blank");
          setIsAwaitingConnection(true);
          // Start polling every 5 seconds
          const interval = setInterval(() => {
            refreshUser();
          }, 5000);
          setPollingInterval(interval);
        } else {
          setConnectionError("Failed to get connect URL");
        }
      }
    } catch (error) {
      console.error("Error connecting to Ollama account:", error);
      setConnectionError(
        error instanceof Error
          ? error.message
          : "Failed to connect to Ollama account",
      );
      setIsAwaitingConnection(false);
    }
  };

  const handleDisconnectOllamaAccount = async () => {
    setConnectionError(null);
    try {
      await disconnectUser();
      window.location.reload();
    } catch {
      setConnectionError("Failed to disconnect Ollama account");
    }
  };

  if (loading) {
    return null;
  }

  if (error || !settings) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-red-500">Failed to load settings</div>
      </div>
    );
  }

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col select-none dark:bg-neutral-900">
      <div className="w-full p-6 overflow-y-auto flex-1 overscroll-contain">
        <fieldset
          disabled={resettingToDefaults}
          aria-busy={resettingToDefaults}
          className="mx-auto max-w-4xl space-y-4 border-0 p-0"
        >
          {/* Appearance */}
          <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-2">
                <CogIcon className="size-5 text-neutral-500" />
                <h2 className="text-base font-medium">Appearance</h2>
              </div>

              <Field>
                <Label>Theme</Label>
                <Description>
                  Colour scheme for the interface. System follows your
                  operating system.
                </Description>
                <Select<ThemeValue>
                  value={theme}
                  onChange={handleThemeChange}
                  options={themeSelectOptions}
                />
              </Field>

              <Field>
                <Label>Font</Label>
                <Description>
                  Typeface for the interface. System uses your platform default.
                </Description>
                <Select<FontValue>
                  value={font}
                  onChange={handleFontChange}
                  options={fontSelectOptions}
                />
              </Field>
            </div>
          </div>

          {/*
            Hidden swatch probes — one per theme. The useEffect above reads
            --color-surface / --color-fg / --color-accent off each so the
            dropdown can preview themes that aren't currently active.
          */}
          <div
            ref={themeProbesRef}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: -9999,
              top: -9999,
              width: 0,
              height: 0,
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {THEME_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                data-probe-key={opt.value}
                data-theme={resolveThemeName(opt.value)}
              />
            ))}
          </div>

          {/* Connect Ollama Account */}
          <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="p-4">
              <Field>
                {isLoading ? (
                  // Loading skeleton, this will only happen if the app started recently
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse w-24"></div>
                      <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse w-32"></div>
                    </div>
                    <div className="h-10 w-10 bg-neutral-200 dark:bg-neutral-700 rounded-full animate-pulse"></div>
                  </div>
                ) : user && user.name ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        <Label className="text-sm font-medium text-neutral-900 dark:text-white">
                          {user?.name}
                        </Label>
                      </div>
                      <Description className="text-sm text-neutral-500 dark:text-neutral-400">
                        {user?.email}
                      </Description>
                      <div className="flex items-center space-x-2 mt-2">
                        {user?.plan === "free" && (
                          <Button
                            type="button"
                            color="dark"
                            className="px-3 py-2 text-sm font-medium bg-black/90 backdrop-blur-sm text-white rounded-lg border border-white/10 shadow-2xl transition-all duration-300 ease-out relative overflow-hidden group"
                            onClick={() =>
                              window.open(
                                "https://ollama.com/upgrade",
                                "_blank",
                              )
                            }
                          >
                            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 via-purple-500/20 to-green-500/20 opacity-60 group-hover:opacity-80 transition-opacity duration-300"></div>
                            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-out"></div>
                            <span className="relative z-10 flex items-center space-x-2">
                              <span>Upgrade</span>
                            </span>
                          </Button>
                        )}
                        <Button
                          type="button"
                          color="white"
                          className="px-3 py-2 text-sm"
                          onClick={() =>
                            window.open("https://ollama.com/settings", "_blank")
                          }
                        >
                          Manage
                        </Button>
                        <Button
                          type="button"
                          color="zinc"
                          className="px-3 py-2 text-sm"
                          onClick={() => void handleDisconnectOllamaAccount()}
                        >
                          Sign out
                        </Button>
                      </div>
                    </div>
                    {user?.avatarurl && (
                      <img
                        src={user.avatarurl}
                        alt={user?.name}
                        className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700 flex-shrink-0"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.className = "hidden";
                        }}
                      />
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Ollama account</Label>
                      <Description>Not connected</Description>
                    </div>
                    <Button
                      type="button"
                      color="white"
                      onClick={handleConnectOllamaAccount}
                      disabled={isRefreshing || isAwaitingConnection}
                    >
                      {isRefreshing || isAwaitingConnection ? (
                        <AnimatedDots />
                      ) : (
                        "Sign In"
                      )}
                    </Button>
                  </div>
                )}
              </Field>
              {connectionError && (
                <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <Text className="text-sm text-red-600 dark:text-red-400">
                    {connectionError}
                  </Text>
                </div>
              )}
            </div>
          </div>

          {/* Local Configuration */}
          <div className="relative overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
            <div className="space-y-4 p-4">
              {/* Expose Ollama */}
              <Field>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start space-x-3 flex-1">
                    <WifiIcon className="mt-1 h-5 w-5 flex-shrink-0 text-black dark:text-neutral-100" />
                    <div>
                      <Label>Expose Ollama to the network</Label>
                      <Description>
                        Allow other devices or services to access Ollama.
                      </Description>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <Switch
                      checked={settings.Expose}
                      onChange={(checked) => handleChange("Expose", checked)}
                    />
                  </div>
                </div>
              </Field>

              {/* Model Directory */}
              <Field>
                <div className="flex items-start space-x-3">
                  <FolderIcon className="mt-1 h-5 w-5 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div className="w-full">
                    <Label>Model location</Label>
                    <Description>Location where models are stored.</Description>
                    <div className="mt-2 flex items-center space-x-2">
                      <Input
                        value={settings.Models || ""}
                        onChange={(e) => handleChange("Models", e.target.value)}
                        readOnly
                      />
                      <Button
                        type="button"
                        color="white"
                        className="px-2"
                        onClick={async () => {
                          if (window.webview?.selectModelsDirectory) {
                            try {
                              const directory =
                                await window.webview.selectModelsDirectory();
                              if (directory) {
                                handleChange("Models", directory);
                              }
                            } catch (error) {
                              console.error(
                                "Error selecting models directory:",
                                error,
                              );
                            }
                          }
                        }}
                      >
                        <FolderIcon className="w-4 h-4 mr-1" />
                        Browse
                      </Button>
                    </div>
                  </div>
                </div>
              </Field>

              {/* Context Length */}
              <Field>
                <div className="flex items-start space-x-3">
                  <CogIcon className="mt-1 h-5 w-5 flex-shrink-0 text-black dark:text-neutral-100" />
                  <div className="w-full">
                    <Label>Context length</Label>
                    <Description>
                      Context length determines how much of your conversation
                      local LLMs can remember and use to generate responses.
                    </Description>
                    <div className="mt-3">
                      <Slider
                        value={Number(settings.ContextLength) || 4096}
                        onChange={(value) => {
                          handleChange("ContextLength", value);
                        }}
                        options={[
                          { value: 4096, label: "4k" },
                          { value: 8192, label: "8k" },
                          { value: 16384, label: "16k" },
                          { value: 32768, label: "32k" },
                          { value: 65536, label: "64k" },
                          { value: 131072, label: "128k" },
                          { value: 262144, label: "256k" },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </Field>
            </div>
          </div>

          {/* Agent Mode */}
          {window.OLLAMA_TOOLS && (
            <div className="overflow-hidden rounded-xl bg-white dark:bg-neutral-800">
              <div className="space-y-4 p-4">
                <Field>
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <BoltIcon className="mt-1 h-5 w-5 flex-shrink-0 text-black dark:text-neutral-100" />
                      <div>
                        <Label>Enable Agent Mode</Label>
                        <Description>
                          Use multi-turn tools to fulfill user requests
                        </Description>
                      </div>
                    </div>
                    <Switch
                      checked={settings.Agent}
                      onChange={(checked) => handleChange("Agent", checked)}
                    />
                  </div>
                </Field>

                {/* Tools Mode */}
                <Field>
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <WrenchIcon className="mt-1 h-5 w-5 flex-shrink-0 text-black dark:text-neutral-100" />
                      <div>
                        <Label>Enable Tools Mode</Label>
                        <Description>
                          Use single-turn tools to fulfill user requests
                        </Description>
                      </div>
                    </div>
                    <Switch
                      checked={settings.Tools}
                      onChange={(checked) => handleChange("Tools", checked)}
                    />
                  </div>
                </Field>
              </div>
            </div>
          )}

          {/* Reset button */}
          <div className="flex items-center justify-between gap-4 px-4">
            {resetError ? (
              <p
                role="alert"
                className="text-xs text-red-600 dark:text-red-400"
              >
                {resetError}
              </p>
            ) : (
              <span />
            )}
            <Button
              type="button"
              color="white"
              className="px-3"
              disabled={resettingToDefaults}
              onClick={() => void handleResetToDefaults()}
            >
              {resettingToDefaults && (
                <ArrowPathIcon data-slot="icon" className="animate-spin" />
              )}
              {resettingToDefaults ? "Resetting…" : "Reset to defaults"}
            </Button>
          </div>
        </fieldset>

        {/* Saved indicator */}
        {(showSaved || restartMessage) && (
          <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 transition-opacity duration-300 z-50">
            <Badge
              color="green"
              className="!bg-green-500 !text-white dark:!bg-green-600"
            >
              Saved
            </Badge>
          </div>
        )}
      </div>
    </main>
  );
}