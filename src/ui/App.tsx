import { useCallback, useEffect, useRef, useState } from "react";
import type { CanUseToolResponse } from "./types";
import { useIPC } from "./hooks/useIPC";
import { useMessageWindow } from "./hooks/useMessageWindow";
import { useAppStore } from "./store/useAppStore";
import type { ServerEvent } from "./types";
import { Sidebar } from "./components/Sidebar";
import { StartSessionModal } from "./components/StartSessionModal";
import { OnboardingModal } from "./components/OnboardingModal";
import { PromptInput, usePromptActions } from "./components/PromptInput";
import { MessageCard } from "./components/EventCard";
import MDContent from "./render/markdown";
import { formatDiagnosticSummary } from "../shared/diagnostics-format";

const SCROLL_THRESHOLD = 50;
type DiagnosticSummaryPayload = Awaited<ReturnType<Window["electron"]["getDiagnosticSummary"]>>;
type RunnerErrorContext = {
  message: string;
  traceId?: string;
  sessionId?: string;
};

function getCodeIslandWarningDetails(
  staticData: Awaited<ReturnType<Window["electron"]["getStaticData"]>>,
): { message: string | null; traceId?: string } {
  const runtime = staticData.codeIsland;
  if (!runtime) return { message: null };

  if (runtime.diagnostic) {
    return {
      message: [runtime.diagnostic.summary, runtime.diagnostic.detail, runtime.diagnostic.action]
        .filter(Boolean)
        .join(" "),
      traceId: runtime.traceId,
    };
  }

  if (runtime.platformSupported && !runtime.available) {
    return {
      message: "Bundled CodeIsland.app is missing. Letta will keep working, but the notch companion is unavailable.",
      traceId: runtime.traceId,
    };
  }

  return { message: null, traceId: runtime.traceId };
}

function App() {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const partialMessageRef = useRef("");
  const [partialMessage, setPartialMessage] = useState("");
  const [showPartialMessage, setShowPartialMessage] = useState(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [codeIslandWarning, setCodeIslandWarning] = useState<string | null>(null);
  const [codeIslandWarningTraceId, setCodeIslandWarningTraceId] = useState<string | null>(null);
  const [codeIslandDiagnosticSummary, setCodeIslandDiagnosticSummary] = useState<DiagnosticSummaryPayload>(null);
  const [lettaServerWarning, setLettaServerWarning] = useState<string | null>(null);
  const [connectionWarning, setConnectionWarning] = useState<string | null>(null);
  const [runnerErrorContext, setRunnerErrorContext] = useState<RunnerErrorContext | null>(null);
  const [globalErrorDiagnosticSummary, setGlobalErrorDiagnosticSummary] = useState<DiagnosticSummaryPayload>(null);
  const [copyFeedback, setCopyFeedback] = useState<"code-island" | "global-error" | null>(null);
  const [configState, setConfigState] = useState<Awaited<ReturnType<Window["electron"]["getAppConfig"]>> | null>(null);
  const prevMessagesLengthRef = useRef(0);
  const scrollHeightBeforeLoadRef = useRef(0);
  const shouldRestoreScrollRef = useRef(false);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);

  const sessions = useAppStore((s) => s.sessions);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const showStartModal = useAppStore((s) => s.showStartModal);
  const setShowStartModal = useAppStore((s) => s.setShowStartModal);
  const globalError = useAppStore((s) => s.globalError);
  const setGlobalError = useAppStore((s) => s.setGlobalError);
  const historyRequested = useAppStore((s) => s.historyRequested);
  const markHistoryRequested = useAppStore((s) => s.markHistoryRequested);
  const resolvePermissionRequest = useAppStore((s) => s.resolvePermissionRequest);
  const handleServerEvent = useAppStore((s) => s.handleServerEvent);
  const prompt = useAppStore((s) => s.prompt);
  const setPrompt = useAppStore((s) => s.setPrompt);
  const cwd = useAppStore((s) => s.cwd);
  const setCwd = useAppStore((s) => s.setCwd);
  const pendingStart = useAppStore((s) => s.pendingStart);

  // Handle partial messages from stream events
  const handlePartialMessages = useCallback((partialEvent: ServerEvent) => {
    if (partialEvent.type !== "stream.message" || partialEvent.payload.message.type !== "stream_event") return;

    const message = partialEvent.payload.message as { type: "stream_event"; event: { type: string; delta?: { text?: string; reasoning?: string } } };
    const event = message.event;
    
    if (event.type === "content_block_start") {
      partialMessageRef.current = "";
      setPartialMessage(partialMessageRef.current);
      setShowPartialMessage(true);
    }

    if (event.type === "content_block_delta" && event.delta) {
      const text = event.delta.text || event.delta.reasoning || "";
      partialMessageRef.current += text;
      setPartialMessage(partialMessageRef.current);
      if (shouldAutoScroll) {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      } else {
        setHasNewMessages(true);
      }
    }

    if (event.type === "content_block_stop") {
      setShowPartialMessage(false);
      setTimeout(() => {
        partialMessageRef.current = "";
        setPartialMessage(partialMessageRef.current);
      }, 500);
    }
  }, [shouldAutoScroll]);

  // Event handler
  const onEvent = useCallback((event: ServerEvent) => {
    if (event.type === "runner.error") {
      setRunnerErrorContext({
        message: event.payload.message,
        traceId: event.payload.traceId,
        sessionId: event.payload.sessionId,
      });
    }
    handleServerEvent(event);
    handlePartialMessages(event);
  }, [handleServerEvent, handlePartialMessages]);

  const { connected, sendEvent } = useIPC(onEvent);
  const { handleStartFromModal } = usePromptActions(sendEvent);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const messages = activeSession?.messages ?? [];
  const permissionRequests = activeSession?.permissionRequests ?? [];
  const isRunning = activeSession?.status === "running";

  const {
    visibleMessages,
    hasMoreHistory,
    isLoadingHistory,
    loadMoreMessages,
    resetToLatest,
    totalMessages,
  } = useMessageWindow(messages, permissionRequests, activeSessionId);

  useEffect(() => {
    let cancelled = false;

    window.electron.getAppConfig()
      .then((nextConfigState) => {
        if (!cancelled) {
          setConfigState(nextConfigState);
          setConnectionWarning(
            nextConfigState.config.connectionType === "letta-server"
              ? null
              : `${nextConfigState.config.connectionType === "anthropic-compatible" ? "Anthropic" : "OpenAI"}-compatible mode is active. Letta will register a BYOK provider on your local Letta server before starting the session.`,
          );
        }
      })
      .catch((error) => {
        console.error("Failed to load app config:", error);
        if (!cancelled) {
          setGlobalError("Could not load Letta configuration.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setGlobalError]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!codeIslandWarningTraceId) {
      setCodeIslandDiagnosticSummary(null);
      return;
    }

    let cancelled = false;
    window.electron.getDiagnosticSummary(codeIslandWarningTraceId)
      .then((summary) => {
        if (!cancelled) {
          setCodeIslandDiagnosticSummary(summary);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCodeIslandDiagnosticSummary(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [codeIslandWarningTraceId]);

  useEffect(() => {
    if (!runnerErrorContext) {
      setGlobalErrorDiagnosticSummary(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const summary = runnerErrorContext.traceId
          ? await window.electron.getDiagnosticSummary(runnerErrorContext.traceId)
          : runnerErrorContext.sessionId
            ? await window.electron.getLatestDiagnosticSummaryForSession(runnerErrorContext.sessionId)
            : null;
        if (!cancelled) {
          setGlobalErrorDiagnosticSummary(summary);
        }
      } catch {
        if (!cancelled) {
          setGlobalErrorDiagnosticSummary(null);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [runnerErrorContext]);

  useEffect(() => {
    if (!globalError) {
      setRunnerErrorContext(null);
      setGlobalErrorDiagnosticSummary(null);
      return;
    }

    if (runnerErrorContext && runnerErrorContext.message !== globalError) {
      setRunnerErrorContext(null);
      setGlobalErrorDiagnosticSummary(null);
    }
  }, [globalError, runnerErrorContext]);

  // 启动时检查 API 配置
  useEffect(() => {
    if (connected && configState && !configState.requiresOnboarding) {
      sendEvent({ type: "session.list" });
    }
  }, [connected, configState, sendEvent]);

  useEffect(() => {
    let cancelled = false;

    window.electron.getStaticData()
      .then((staticData) => {
        if (cancelled) return;

        const codeIslandDetails = getCodeIslandWarningDetails(staticData);
        setCodeIslandWarning(codeIslandDetails.message);
        setCodeIslandWarningTraceId(codeIslandDetails.traceId ?? null);

        const needsBundledServer = configState?.config.connectionType !== "letta-server";

        if (needsBundledServer && staticData.lettaServer?.platformSupported && !staticData.lettaServer.available) {
          setLettaServerWarning("Bundled Letta server runtime is missing. Compatible provider modes will not be available in this build.");
          return;
        }

        if (needsBundledServer && staticData.lettaServer?.status === "failed") {
          setLettaServerWarning(
            staticData.lettaServer.lastError
              ? `Bundled Letta server failed to start: ${staticData.lettaServer.lastError}`
              : "Bundled Letta server failed to start.",
          );
          return;
        }

        setLettaServerWarning(null);
      })
      .catch((error) => {
        console.error("Failed to load static app data:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [configState]);

  const handleCopyDiagnostics = useCallback(async (
    summary: DiagnosticSummaryPayload,
    feedbackKey: "code-island" | "global-error",
  ) => {
    if (!summary) return;

    try {
      await navigator.clipboard.writeText(formatDiagnosticSummary(summary));
      setCopyFeedback(feedbackKey);
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopyFeedback((current) => (current === feedbackKey ? null : current));
        copyFeedbackTimeoutRef.current = null;
      }, 1600);
    } catch {
      setGlobalError("Failed to copy diagnostics.");
    }
  }, [setGlobalError]);

  const handleConfigSaved = useCallback((nextConfigState: Awaited<ReturnType<Window["electron"]["getAppConfig"]>>) => {
    setConfigState(nextConfigState);
    setConnectionWarning(
      nextConfigState.config.connectionType === "letta-server"
        ? null
        : `${nextConfigState.config.connectionType === "anthropic-compatible" ? "Anthropic" : "OpenAI"}-compatible mode is active. Letta will register a BYOK provider on your local Letta server before starting the session.`,
    );
    if (!nextConfigState.requiresOnboarding) {
      sendEvent({ type: "session.list" });
    }
  }, [sendEvent]);

  useEffect(() => {
    if (!activeSessionId || !connected) return;
    const session = sessions[activeSessionId];
    if (session && !session.hydrated && !historyRequested.has(activeSessionId)) {
      markHistoryRequested(activeSessionId);
      sendEvent({ type: "session.history", payload: { sessionId: activeSessionId } });
    }
  }, [activeSessionId, connected, sessions, historyRequested, markHistoryRequested, sendEvent]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - SCROLL_THRESHOLD;

    if (isAtBottom !== shouldAutoScroll) {
      setShouldAutoScroll(isAtBottom);
      if (isAtBottom) {
        setHasNewMessages(false);
      }
    }
  }, [shouldAutoScroll]);

  // Set up IntersectionObserver for top sentinel
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMoreHistory && !isLoadingHistory) {
          scrollHeightBeforeLoadRef.current = container.scrollHeight;
          shouldRestoreScrollRef.current = true;
          loadMoreMessages();
        }
      },
      {
        root: container,
        rootMargin: "100px 0px 0px 0px",
        threshold: 0,
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreHistory, isLoadingHistory, loadMoreMessages]);

  // Restore scroll position after loading history
  useEffect(() => {
    if (shouldRestoreScrollRef.current && !isLoadingHistory) {
      const container = scrollContainerRef.current;
      if (container) {
        const newScrollHeight = container.scrollHeight;
        const scrollDiff = newScrollHeight - scrollHeightBeforeLoadRef.current;
        container.scrollTop += scrollDiff;
      }
      shouldRestoreScrollRef.current = false;
    }
  }, [visibleMessages, isLoadingHistory]);

  // Reset scroll state on session change
  useEffect(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    prevMessagesLengthRef.current = 0;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, 100);
  }, [activeSessionId]);

  useEffect(() => {
    if (shouldAutoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (messages.length > prevMessagesLengthRef.current && prevMessagesLengthRef.current > 0) {
      setHasNewMessages(true);
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages, partialMessage, shouldAutoScroll]);

  const scrollToBottom = useCallback(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    resetToLatest();
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [resetToLatest]);

  const handleNewSession = useCallback(() => {
    useAppStore.getState().setActiveSessionId(null);
    setShowStartModal(true);
  }, [setShowStartModal]);

  const handleDeleteSession = useCallback((sessionId: string) => {
    sendEvent({ type: "session.delete", payload: { sessionId } });
  }, [sendEvent]);

  const handleOpenSettings = useCallback(() => {
    setShowSettingsModal(true);
  }, []);

  const handlePermissionResult = useCallback((toolUseId: string, result: CanUseToolResponse) => {
    if (!activeSessionId) return;
    sendEvent({ type: "permission.response", payload: { sessionId: activeSessionId, toolUseId, result } });
    resolvePermissionRequest(activeSessionId, toolUseId);
  }, [activeSessionId, sendEvent, resolvePermissionRequest]);

  const handleSendMessage = useCallback(() => {
    setShouldAutoScroll(true);
    setHasNewMessages(false);
    resetToLatest();
  }, [resetToLatest]);

  return (
    <div className="flex h-screen bg-surface">
      <Sidebar
        connected={connected}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={handleOpenSettings}
      />

      <main className="flex flex-1 flex-col ml-[280px] bg-surface-cream">
        <div
          className="flex items-center justify-center h-12 border-b border-ink-900/10 bg-surface-cream select-none"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <span className="text-sm font-medium text-ink-700">{activeSession?.title || "Letta"}</span>
        </div>

        {codeIslandWarning && (
          <div className="border-b border-warning/20 bg-warning-light px-6 py-3">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="text-sm font-medium text-warning">{codeIslandWarning}</span>
              {codeIslandDiagnosticSummary && (
                <button
                  className="text-xs font-medium text-warning underline-offset-2 transition-colors hover:text-warning/80 hover:underline"
                  onClick={() => void handleCopyDiagnostics(codeIslandDiagnosticSummary, "code-island")}
                >
                  {copyFeedback === "code-island" ? "Copied" : "Copy diagnostics"}
                </button>
              )}
              <button
                className="ml-auto text-warning transition-colors hover:text-warning/80"
                onClick={() => {
                  setCodeIslandWarning(null);
                  setCodeIslandWarningTraceId(null);
                  setCodeIslandDiagnosticSummary(null);
                }}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {lettaServerWarning && (
          <div className="border-b border-warning/20 bg-warning-light px-6 py-3">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="text-sm font-medium text-warning">{lettaServerWarning}</span>
              <button
                className="ml-auto text-warning transition-colors hover:text-warning/80"
                onClick={() => setLettaServerWarning(null)}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {connectionWarning && (
          <div className="border-b border-info/20 bg-info-light px-6 py-3">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="text-sm font-medium text-info">{connectionWarning}</span>
              <button
                className="ml-auto text-info transition-colors hover:text-info/80"
                onClick={() => setConnectionWarning(null)}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-8 pb-40 pt-6"
        >
          <div className="mx-auto max-w-3xl">
            <div ref={topSentinelRef} className="h-1" />

            {!hasMoreHistory && totalMessages > 0 && (
              <div className="flex items-center justify-center py-4 mb-4">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <div className="h-px w-12 bg-ink-900/10" />
                  <span>Beginning of conversation</span>
                  <div className="h-px w-12 bg-ink-900/10" />
                </div>
              </div>
            )}

            {isLoadingHistory && (
              <div className="flex items-center justify-center py-4 mb-4">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>Loading...</span>
                </div>
              </div>
            )}

            {visibleMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="text-lg font-medium text-ink-700">No messages yet</div>
                <p className="mt-2 text-sm text-muted">Start a conversation with Letta</p>
              </div>
            ) : (
              visibleMessages.map((item, idx) => (
                <MessageCard
                  key={`${activeSessionId}-msg-${item.originalIndex}`}
                  message={item.message}
                  isLast={idx === visibleMessages.length - 1}
                  isRunning={isRunning}
                  permissionRequest={permissionRequests[0]}
                  onPermissionResult={handlePermissionResult}
                />
              ))
            )}

            {/* Partial message display with skeleton loading */}
            {partialMessage && (
              <div className="partial-message mt-4">
                <div className="header text-accent">Assistant</div>
                <MDContent text={partialMessage} />
              </div>
            )}
            {showPartialMessage && !partialMessage && (
              <div className="mt-3 flex flex-col gap-2 px-1">
                <div className="relative h-3 w-2/12 overflow-hidden rounded-full bg-ink-900/10">
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                </div>
                <div className="relative h-3 w-full overflow-hidden rounded-full bg-ink-900/10">
                  <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-ink-900/30 to-transparent animate-shimmer" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        <PromptInput
          sendEvent={sendEvent}
          onSendMessage={handleSendMessage}
          disabled={!activeSessionId}
        />

        {hasNewMessages && !shouldAutoScroll && (
          <button
            onClick={scrollToBottom}
            className="fixed bottom-28 left-1/2 ml-[140px] z-40 -translate-x-1/2 flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg transition-all hover:bg-accent-hover hover:scale-105 animate-bounce-subtle"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12l7 7 7-7" />
            </svg>
            <span>New messages</span>
          </button>
        )}
      </main>

      {showStartModal && (
        <StartSessionModal
          cwd={cwd}
          prompt={prompt}
          pendingStart={pendingStart}
          onCwdChange={setCwd}
          onPromptChange={setPrompt}
          onStart={handleStartFromModal}
          onClose={() => setShowStartModal(false)}
        />
      )}

      {globalError && (
        <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-error/20 bg-error-light px-4 py-3 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-sm text-error">{globalError}</span>
            {globalErrorDiagnosticSummary && (
              <button
                className="text-xs font-medium text-error underline-offset-2 transition-colors hover:text-error/80 hover:underline"
                onClick={() => void handleCopyDiagnostics(globalErrorDiagnosticSummary, "global-error")}
              >
                {copyFeedback === "global-error" ? "Copied" : "Copy diagnostics"}
              </button>
            )}
            <button
              className="text-error hover:text-error/80"
              onClick={() => {
                setGlobalError(null);
                setRunnerErrorContext(null);
                setGlobalErrorDiagnosticSummary(null);
              }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {configState?.requiresOnboarding && (
        <OnboardingModal
          configState={configState}
          onSaved={handleConfigSaved}
        />
      )}

      {configState && !configState.requiresOnboarding && showSettingsModal && (
        <OnboardingModal
          configState={configState}
          mode="settings"
          onSaved={handleConfigSaved}
          onClose={() => setShowSettingsModal(false)}
        />
      )}
    </div>
  );
}

export default App;
