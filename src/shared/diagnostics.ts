import type { DecisionId } from "./decision-ids.js";
import type { ErrorCode } from "./error-codes.js";

export type DiagnosticStatus = "ok" | "warning" | "error";

export type DiagnosticStep = {
  component: string;
  decisionId?: DecisionId;
  status: DiagnosticStatus;
  message: string;
  errorCode?: ErrorCode;
  data?: Record<string, unknown>;
};

export type DiagnosticSummary = {
  traceId: string;
  turnId?: string;
  sessionId?: string;
  summary: string;
  errorCode?: ErrorCode;
  lastSuccessfulDecisionId?: DecisionId;
  firstFailedDecisionId?: DecisionId;
  suggestedAction?: string;
  createdAt?: string;
  updatedAt?: string;
  stepCount?: number;
  steps: DiagnosticStep[];
};

export type DiagnosticSummaryListItem = Omit<DiagnosticSummary, "steps">;

export type DiagnosticIncidentSample = DiagnosticSummary & {
  fingerprint: string;
  capturedAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  recentTraceIds: string[];
};
