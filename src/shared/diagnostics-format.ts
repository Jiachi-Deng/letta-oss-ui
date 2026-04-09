type DiagnosticSummaryLike = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
  summary: string;
  errorCode?: string;
  lastSuccessfulDecisionId?: string;
  firstFailedDecisionId?: string;
  suggestedAction?: string;
  steps: Array<{
    component: string;
    decisionId?: string;
    status: "ok" | "warning" | "error";
    message: string;
  }>;
};

export function formatDiagnosticSummary(summary: DiagnosticSummaryLike): string {
  const headerLines = [
    `Summary: ${summary.summary}`,
    `Trace ID: ${summary.traceId}`,
    `Turn ID: ${summary.turnId ?? "n/a"}`,
    `Session ID: ${summary.sessionId ?? "n/a"}`,
    `Error Code: ${summary.errorCode ?? "n/a"}`,
    `Last Successful Decision: ${summary.lastSuccessfulDecisionId ?? "n/a"}`,
    `First Failed Decision: ${summary.firstFailedDecisionId ?? "n/a"}`,
    `Suggested Action: ${summary.suggestedAction ?? "n/a"}`,
  ];

  const stepLines = summary.steps.map((step, index) =>
    `${index + 1}. ${step.status} | ${step.component} | ${step.decisionId ?? "n/a"} | ${step.message}`,
  );

  return [...headerLines, "", "Steps:", ...stepLines].join("\n");
}
