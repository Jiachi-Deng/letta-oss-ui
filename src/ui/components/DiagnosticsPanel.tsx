import { useEffect, useMemo, useRef, useState } from "react";
import { formatDiagnosticSummary, formatFullDiagnosticTrace } from "../../shared/diagnostics-format";

type DiagnosticSummaryListItem = Awaited<ReturnType<Window["electron"]["listDiagnosticSummaries"]>>[number];
type DiagnosticSummaryDetail = Awaited<ReturnType<Window["electron"]["getDiagnosticSummary"]>>;

interface DiagnosticsPanelProps {
  onBackToChat: () => void;
}

type CopyMode = "compact" | "full" | null;

function formatTime(value?: string): string {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

export function DiagnosticsPanel({ onBackToChat }: DiagnosticsPanelProps) {
  const [traces, setTraces] = useState<DiagnosticSummaryListItem[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<DiagnosticSummaryDetail>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMode, setCopyMode] = useState<CopyMode>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedErrorCode, setSelectedErrorCode] = useState<string>("all");
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    window.electron.listDiagnosticSummaries()
      .then((items) => {
        if (cancelled) return;
        setTraces(items);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error("Failed to load diagnostics summaries:", loadError);
        setError("Could not load diagnostics history.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const visibleTraces = useMemo(() => {
    const normalizedSearch = normalizeSearchValue(searchTerm);

    return traces.filter((trace) => {
      if (selectedErrorCode !== "all" && trace.errorCode !== selectedErrorCode) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [
        trace.traceId,
        trace.sessionId ?? "",
        trace.turnId ?? "",
        trace.summary,
        trace.errorCode ?? "",
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
    });
  }, [searchTerm, selectedErrorCode, traces]);

  const errorCodeOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const trace of traces) {
      if (trace.errorCode) {
        codes.add(trace.errorCode);
      }
    }
    return [...codes].sort();
  }, [traces]);

  const effectiveSelectedTraceId = useMemo(() => {
    if (visibleTraces.length === 0) return null;
    if (selectedTraceId && visibleTraces.some((item) => item.traceId === selectedTraceId)) {
      return selectedTraceId;
    }
    return visibleTraces[0].traceId;
  }, [selectedTraceId, visibleTraces]);

  const visibleSelectedSummary = selectedSummary?.traceId === effectiveSelectedTraceId
    ? selectedSummary
    : null;
  const isLoadingSelectedTrace = Boolean(effectiveSelectedTraceId && !visibleSelectedSummary && !error);

  useEffect(() => {
    if (!effectiveSelectedTraceId) {
      return;
    }

    let cancelled = false;

    window.electron.getDiagnosticSummary(effectiveSelectedTraceId)
      .then((summary) => {
        if (cancelled) return;
        setSelectedSummary(summary);
        setError(null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.error("Failed to load diagnostic summary:", loadError);
        setSelectedSummary(null);
        setError("Could not load the selected diagnostic trace.");
      })

    return () => {
      cancelled = true;
    };
  }, [effectiveSelectedTraceId]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const resetCopyFeedback = () => {
    if (copyTimeoutRef.current !== null) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
  };

  const copyText = async (text: string, mode: Exclude<CopyMode, null>) => {
    try {
      await navigator.clipboard.writeText(text);
      resetCopyFeedback();
      setCopyMode(mode);
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopyMode(null);
        copyTimeoutRef.current = null;
      }, 1500);
    } catch (copyError) {
      console.error("Failed to copy diagnostics from diagnostics page:", copyError);
      setError("Could not copy diagnostics.");
    }
  };

  const clearFilters = () => {
    setSearchTerm("");
    setSelectedErrorCode("all");
  };

  const hasActiveFilters = searchTerm.trim().length > 0 || selectedErrorCode !== "all";

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-cream">
      <div className="flex items-center justify-between border-b border-ink-900/10 px-6 py-4">
        <div>
          <div className="text-lg font-semibold text-ink-800">Diagnostics</div>
          <p className="mt-1 text-sm text-muted">
            Filter by error code, search by trace or session ID, then copy either the compact diagnostics or the full trace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveFilters && (
            <button
              type="button"
              className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-tertiary"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          )}
          <button
            type="button"
            className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-tertiary"
            onClick={onBackToChat}
          >
            Back to Chat
          </button>
        </div>
      </div>

      <div className="border-b border-ink-900/10 bg-surface px-6 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="diagnostics-search">
            Search traces
            <input
              id="diagnostics-search"
              className="rounded-xl border border-ink-900/10 bg-surface-cream px-4 py-2.5 text-sm text-ink-800 outline-none transition-colors placeholder:text-muted/70 focus:border-accent/30 focus:ring-2 focus:ring-accent/10"
              placeholder="Search traceId, sessionId, or summary"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </label>

          <label className="flex min-w-[220px] flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="diagnostics-error-code">
            Error code
            <select
              id="diagnostics-error-code"
              className="rounded-xl border border-ink-900/10 bg-surface-cream px-4 py-2.5 text-sm text-ink-800 outline-none transition-colors focus:border-accent/30 focus:ring-2 focus:ring-accent/10"
              value={selectedErrorCode}
              onChange={(event) => setSelectedErrorCode(event.target.value)}
            >
              <option value="all">All error codes</option>
              {errorCodeOptions.map((errorCode) => (
                <option key={errorCode} value={errorCode}>
                  {errorCode}
                </option>
              ))}
            </select>
          </label>

          <div className="ml-auto text-xs text-muted">
            {visibleTraces.length} of {traces.length} traces
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[380px] shrink-0 border-r border-ink-900/10 bg-surface px-4 py-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">Recent traces</div>
            <div className="text-xs text-muted">{visibleTraces.length} shown</div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {traces.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink-900/10 bg-surface-secondary px-4 py-6 text-sm text-muted">
                No persisted traces yet. Run a session or trigger a warning banner to populate this list.
              </div>
            ) : visibleTraces.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-ink-900/10 bg-surface-secondary px-4 py-6 text-sm text-muted">
                No traces match the current filters. Clear filters to see the full history.
              </div>
            ) : (
              visibleTraces.map((trace) => {
                const isSelected = trace.traceId === effectiveSelectedTraceId;
                return (
                  <button
                    key={trace.traceId}
                    type="button"
                    data-testid={`diagnostics-trace-card-${trace.traceId}`}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      isSelected
                        ? "border-accent/30 bg-accent-subtle"
                        : "border-ink-900/10 bg-surface hover:bg-surface-tertiary"
                    }`}
                    onClick={() => setSelectedTraceId(trace.traceId)}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-medium text-ink-800">
                        {trace.summary}
                      </span>
                      <span className="shrink-0 rounded-full bg-ink-900/5 px-2 py-0.5 text-[11px] text-muted">
                        {trace.stepCount ?? 0} steps
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted">
                      <span>{trace.traceId}</span>
                      {trace.sessionId && <span>Session: {trace.sessionId}</span>}
                      {trace.errorCode && <span>{trace.errorCode}</span>}
                    </div>
                    <div className="mt-2 text-[11px] text-muted">
                      Updated {formatTime(trace.updatedAt)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 rounded-2xl border border-error/20 bg-error-light px-4 py-3 text-sm text-error">
              {error}
            </div>
          )}

          {!effectiveSelectedTraceId && !isLoadingSelectedTrace && (
            <div className="flex flex-1 items-center justify-center text-center">
              <div>
                <div className="text-lg font-medium text-ink-800">
                  {traces.length === 0 ? "No trace history yet" : "Select a trace"}
                </div>
                <p className="mt-2 text-sm text-muted">
                  {traces.length === 0
                    ? "Run a session or trigger a warning banner to populate this page."
                    : "Choose one of the recent traces on the left to see the summary and steps."}
                </p>
              </div>
            </div>
          )}

          {visibleSelectedSummary && (
            <div className="grid gap-4">
              <div className="rounded-2xl border border-ink-900/10 bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-accent">Trace summary</div>
                    <h2 className="mt-2 text-xl font-semibold text-ink-800">{visibleSelectedSummary.summary}</h2>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                      <span className="rounded-full bg-ink-900/5 px-3 py-1">{visibleSelectedSummary.traceId}</span>
                      <span className="rounded-full bg-ink-900/5 px-3 py-1">Turn: {visibleSelectedSummary.turnId ?? "n/a"}</span>
                      <span className="rounded-full bg-ink-900/5 px-3 py-1">Session: {visibleSelectedSummary.sessionId ?? "n/a"}</span>
                      <span className="rounded-full bg-ink-900/5 px-3 py-1">Steps: {visibleSelectedSummary.stepCount ?? visibleSelectedSummary.steps.length}</span>
                      <span className="rounded-full bg-ink-900/5 px-3 py-1">Updated: {formatTime(visibleSelectedSummary.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-tertiary"
                      onClick={() => void copyText(formatDiagnosticSummary(visibleSelectedSummary), "compact")}
                    >
                      {copyMode === "compact" ? "Copied" : "Copy diagnostics"}
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-ink-900/10 bg-surface px-4 py-2 text-sm text-ink-700 transition-colors hover:bg-surface-tertiary"
                      onClick={() => void copyText(formatFullDiagnosticTrace(visibleSelectedSummary), "full")}
                    >
                      {copyMode === "full" ? "Copied" : "Copy full trace"}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-2">
                  <div className="text-sm text-ink-700">
                    <span className="font-medium">Error code:</span> {visibleSelectedSummary.errorCode ?? "n/a"}
                  </div>
                  <div className="text-sm text-ink-700">
                    <span className="font-medium">Last successful decision:</span> {visibleSelectedSummary.lastSuccessfulDecisionId ?? "n/a"}
                  </div>
                  <div className="text-sm text-ink-700">
                    <span className="font-medium">First failed decision:</span> {visibleSelectedSummary.firstFailedDecisionId ?? "n/a"}
                  </div>
                  <div className="text-sm text-ink-700">
                    <span className="font-medium">Suggested action:</span> {visibleSelectedSummary.suggestedAction ?? "n/a"}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-ink-900/10 bg-surface p-5 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-wide text-accent">Steps</div>
                <div className="mt-2 text-sm text-muted">
                  Use <span className="font-medium text-ink-700">Copy diagnostics</span> for the compact summary and <span className="font-medium text-ink-700">Copy full trace</span> when you need step data and key metadata.
                </div>
                <div className="mt-4 grid gap-3">
                  {visibleSelectedSummary.steps.map((step, index) => (
                    <div key={`${visibleSelectedSummary.traceId}-${index}`} className="rounded-xl border border-ink-900/10 bg-surface-secondary px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            step.status === "error"
                              ? "bg-error-light text-error"
                              : step.status === "warning"
                                ? "bg-warning-light text-warning"
                                : "bg-success/10 text-success"
                          }`}
                        >
                          {step.status}
                        </span>
                        <span className="text-sm font-medium text-ink-800">{step.component}</span>
                        {step.decisionId && <span className="rounded-full bg-ink-900/5 px-2.5 py-1 text-[11px] text-muted">{step.decisionId}</span>}
                        {step.errorCode && <span className="text-xs text-muted">{step.errorCode}</span>}
                      </div>
                      <div className="mt-2 text-sm text-ink-700">{step.message}</div>
                      {step.data && Object.keys(step.data).length > 0 && (
                        <pre className="mt-3 overflow-x-auto rounded-xl bg-surface px-4 py-3 text-xs text-ink-700">
                          {JSON.stringify(step.data, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!visibleSelectedSummary && isLoadingSelectedTrace && (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-muted">
              Loading trace details...
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
