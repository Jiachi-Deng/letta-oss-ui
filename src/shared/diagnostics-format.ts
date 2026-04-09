type DiagnosticSummaryLike = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
  summary: string;
  errorCode?: string;
  lastSuccessfulDecisionId?: string;
  firstFailedDecisionId?: string;
  suggestedAction?: string;
  createdAt?: string;
  updatedAt?: string;
  stepCount?: number;
  steps: Array<{
    component: string;
    decisionId?: string;
    status: "ok" | "warning" | "error";
    message: string;
    errorCode?: string;
    data?: Record<string, unknown>;
  }>;
};

function formatHeaderLines(summary: DiagnosticSummaryLike): string[] {
  return [
    `Summary: ${summary.summary}`,
    `Trace ID: ${summary.traceId}`,
    `Turn ID: ${summary.turnId ?? "n/a"}`,
    `Session ID: ${summary.sessionId ?? "n/a"}`,
    `Error Code: ${summary.errorCode ?? "n/a"}`,
    `Last Successful Decision: ${summary.lastSuccessfulDecisionId ?? "n/a"}`,
    `First Failed Decision: ${summary.firstFailedDecisionId ?? "n/a"}`,
    `Suggested Action: ${summary.suggestedAction ?? "n/a"}`,
    `Created At: ${summary.createdAt ?? "n/a"}`,
    `Updated At: ${summary.updatedAt ?? "n/a"}`,
    `Step Count: ${summary.stepCount ?? summary.steps.length}`,
  ];
}

export function formatDiagnosticSummary(summary: DiagnosticSummaryLike): string {
  const stepLines = summary.steps.map((step, index) =>
    `${index + 1}. ${step.status} | ${step.component} | ${step.decisionId ?? "n/a"} | ${step.message}`,
  );

  return [...formatHeaderLines(summary), "", "Steps:", ...stepLines].join("\n");
}

export function formatFullDiagnosticTrace(summary: DiagnosticSummaryLike): string {
  const stepBlocks = summary.steps.map((step, index) => {
    const lines = [
      `${index + 1}. ${step.status} | ${step.component} | ${step.decisionId ?? "n/a"} | ${step.message}`,
    ];

    if (step.errorCode) {
      lines.push(`   Error Code: ${step.errorCode}`);
    }

    if (step.data && Object.keys(step.data).length > 0) {
      lines.push(`   Data: ${JSON.stringify(step.data, null, 2)}`);
    }

    return lines.join("\n");
  });

  return [...formatHeaderLines(summary), "", "Steps:", ...stepBlocks].join("\n");
}
