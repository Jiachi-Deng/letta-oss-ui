import { useMemo, useState } from "react";
import type { ResidentCoreTelegramStartupConfig } from "../../electron/libs/config.js";

type AppConfigState = Awaited<ReturnType<Window["electron"]["getAppConfig"]>>;
type TelegramDmPolicy = NonNullable<ResidentCoreTelegramStartupConfig["dmPolicy"]>;

interface OnboardingModalProps {
  configState: AppConfigState;
  onSaved: (nextState: AppConfigState) => void;
  onClose?: () => void;
  mode?: "onboarding" | "settings";
}

function isLocalBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
}

function getConnectionHelpText(connectionType: AppConfigState["config"]["connectionType"]): string {
  switch (connectionType) {
    case "anthropic-compatible":
      return "Use this for Anthropic-compatible gateways. Letta will register a BYOK provider on your local Letta server. Model is required and must match the provider exactly.";
    case "openai-compatible":
      return "Use this for OpenAI-compatible gateways. Letta will register a BYOK provider on your local Letta server. Model is required and must match the provider exactly.";
    default:
      return "Use Letta Cloud or a self-hosted Letta server. Model is optional in this mode.";
  }
}

function buildTelegramConfig(
  token: string,
  dmPolicy: TelegramDmPolicy,
  streaming: boolean,
  workingDir: string,
): ResidentCoreTelegramStartupConfig | null {
  const trimmedToken = token.trim();
  const trimmedWorkingDir = workingDir.trim();

  if (!trimmedToken && !trimmedWorkingDir && dmPolicy === "open" && streaming) {
    return null;
  }

  return {
    token: trimmedToken || undefined,
    dmPolicy,
    streaming,
    workingDir: trimmedWorkingDir || undefined,
  };
}

export function OnboardingModal({
  configState,
  onSaved,
  onClose,
  mode = "onboarding",
}: OnboardingModalProps) {
  const [connectionType, setConnectionType] = useState(configState.config.connectionType);
  const [baseUrl, setBaseUrl] = useState(configState.config.LETTA_BASE_URL);
  const [apiKey, setApiKey] = useState(configState.config.LETTA_API_KEY ?? "");
  const [model, setModel] = useState(configState.config.model ?? "");
  const [telegramToken, setTelegramToken] = useState(configState.config.residentCore?.telegram?.token ?? "");
  const [telegramDmPolicy, setTelegramDmPolicy] = useState<TelegramDmPolicy>(
    configState.config.residentCore?.telegram?.dmPolicy ?? "open",
  );
  const [telegramStreaming, setTelegramStreaming] = useState(
    configState.config.residentCore?.telegram?.streaming ?? true,
  );
  const [telegramWorkingDir, setTelegramWorkingDir] = useState(
    configState.config.residentCore?.telegram?.workingDir ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localServerSelected = useMemo(() => isLocalBaseUrl(baseUrl), [baseUrl]);
  const apiKeyRequired = connectionType === "letta-server" ? !localServerSelected : true;
  const modelRequired = connectionType !== "letta-server";
  const isSettingsMode = mode === "settings";

  const handleSave = async () => {
    const trimmedBaseUrl = baseUrl.trim();
    const trimmedApiKey = apiKey.trim();

    if (!trimmedBaseUrl) {
      setError("Base URL is required.");
      return;
    }

    if (apiKeyRequired && !trimmedApiKey) {
      setError("API key is required for this connection type.");
      return;
    }

    if (modelRequired && !model.trim()) {
      setError("Model is required for compatible API modes.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const nextState = await window.electron.saveAppConfig({
        connectionType,
        LETTA_BASE_URL: trimmedBaseUrl,
        LETTA_API_KEY: trimmedApiKey || undefined,
        model: model.trim() || undefined,
        residentCore: {
          telegram: buildTelegramConfig(telegramToken, telegramDmPolicy, telegramStreaming, telegramWorkingDir),
        },
      });
      onSaved(nextState);
      onClose?.();
    } catch (saveError) {
      console.error("Failed to save Letta config:", saveError);
      setError("Could not save your Letta settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/25 p-4 backdrop-blur-sm sm:p-8">
      <div
        data-testid="onboarding-modal-panel"
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-ink-900/5 bg-surface shadow-elevated sm:max-h-[calc(100dvh-4rem)]"
      >
        <div className="shrink-0 border-b border-ink-900/5 px-6 py-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-ink-800">
                {isSettingsMode ? "Letta Settings" : "Finish Setting Up Letta"}
              </div>
              <p className="mt-2 text-sm text-muted">
                {isSettingsMode
                  ? "Update your connection settings without leaving the app."
                  : "First launch needs one connection setting before you can start chatting."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                {isSettingsMode ? "Settings" : "First Launch"}
              </div>
              {onClose && (
                <button
                  type="button"
                  className="rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink-900/10 hover:text-ink-700"
                  onClick={onClose}
                  aria-label="Close settings"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        <div
          data-testid="onboarding-modal-scroll-body"
          className="min-h-0 flex-1 overflow-y-auto px-6 py-5"
        >
          <div className="grid gap-4">
            <div className="rounded-2xl border border-ink-900/10 bg-surface-secondary px-4 py-3 text-sm text-ink-700">
              {getConnectionHelpText(connectionType)}
            </div>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted">Connection Type</span>
              <select
                className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                value={connectionType}
                onChange={(event) => setConnectionType(event.target.value as AppConfigState["config"]["connectionType"])}
              >
                <option value="letta-server">Letta Server</option>
                <option value="anthropic-compatible">Anthropic-compatible</option>
                <option value="openai-compatible">OpenAI-compatible</option>
              </select>
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted">Base URL</span>
              <input
                className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder="https://api.letta.com"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted">
                API Key
                {apiKeyRequired ? " (required)" : " (optional for localhost)"}
              </span>
              <input
                type="password"
                className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder={apiKeyRequired ? "letta_..." : "Leave blank for localhost"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-xs font-medium text-muted">
                Model
                {modelRequired ? " (required)" : " (optional)"}
              </span>
              <input
                className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                placeholder={modelRequired ? "MiniMax-M2.7" : "Optional model override"}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </label>

            <div className="rounded-2xl border border-ink-900/10 bg-surface-secondary/70 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-ink-800">Telegram</div>
                  <p className="mt-1 text-xs text-muted">
                    Configure the Telegram bot used by Resident Core. Leave the token blank to disable Telegram for this profile.
                  </p>
                </div>
                <div className="rounded-full bg-accent/10 px-3 py-1 text-[11px] font-medium text-accent">
                  Optional
                </div>
              </div>

              <div className="mt-4 grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted">Bot Token</span>
                  <input
                    type="password"
                    className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                    placeholder="123456:ABC-DEF..."
                    value={telegramToken}
                    onChange={(event) => setTelegramToken(event.target.value)}
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted">DM Policy</span>
                  <select
                    className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm text-ink-800 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                    value={telegramDmPolicy}
                    onChange={(event) => setTelegramDmPolicy(event.target.value as TelegramDmPolicy)}
                  >
                    <option value="open">Open</option>
                    <option value="allowlist">Allowlist</option>
                    <option value="pairing">Pairing</option>
                  </select>
                </label>

                <label className="flex items-center justify-between gap-4 rounded-xl border border-ink-900/10 bg-surface px-4 py-3">
                  <div className="grid gap-0.5">
                    <span className="text-xs font-medium text-muted">Streaming</span>
                    <span className="text-[11px] text-muted-light">Stream Telegram replies while they are being generated.</span>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-ink-900/20 text-accent focus:ring-accent/20"
                    checked={telegramStreaming}
                    onChange={(event) => setTelegramStreaming(event.target.checked)}
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted">Working Directory</span>
                  <input
                    className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm text-ink-800 placeholder:text-muted-light focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
                    placeholder="/Users/jachi/Desktop/letta-workspace"
                    value={telegramWorkingDir}
                    onChange={(event) => setTelegramWorkingDir(event.target.value)}
                  />
                </label>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-error/20 bg-error-light px-4 py-3 text-sm text-error">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-ink-900/5 bg-surface px-6 py-4">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-tertiary"
              onClick={() => {
                setConnectionType("letta-server");
                setBaseUrl("https://api.letta.com");
                setApiKey("");
                setModel("");
                setTelegramToken("");
                setTelegramDmPolicy("open");
                setTelegramStreaming(true);
                setTelegramWorkingDir("");
                setError(null);
              }}
            >
              Reset
            </button>
            {onClose && (
              <button
                type="button"
                className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-tertiary"
                onClick={onClose}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : isSettingsMode ? "Save Changes" : "Save And Continue"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
