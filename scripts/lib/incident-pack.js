import path from "node:path";

function formatHeaderLines(summary) {
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

export function formatCompactDiagnostics(summary) {
  const stepLines = summary.steps.map((step, index) =>
    `${index + 1}. ${step.status} | ${step.component} | ${step.decisionId ?? "n/a"} | ${step.message}`,
  );

  return [...formatHeaderLines(summary), "", "Steps:", ...stepLines].join("\n");
}

export function formatFullTrace(summary) {
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

export function slugifyIncidentPart(value) {
  return String(value ?? "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

export function buildIncidentFingerprint(summary) {
  return [
    summary.errorCode ?? "no-error-code",
    summary.firstFailedDecisionId ?? "no-first-failed-decision",
    summary.lastSuccessfulDecisionId ?? "no-last-successful-decision",
    summary.steps.find((step) => step.status === "error")?.component ?? "no-error-component",
  ].join("::");
}

export function buildIncidentFileName(incident) {
  const datePart = (incident.capturedAt ?? incident.updatedAt ?? new Date().toISOString()).slice(0, 10);
  const slug = slugifyIncidentPart(incident.fingerprint ?? incident.errorCode ?? incident.traceId);
  const tracePart = slugifyIncidentPart(incident.traceId).slice(0, 24);
  return `${datePart}-${slug}-${tracePart}.json`;
}

export function synthesizeIncidentsFromTraces(traces) {
  const grouped = new Map();

  for (const trace of traces) {
    if (!trace?.errorCode && !trace?.firstFailedDecisionId) {
      continue;
    }

    const fingerprint = buildIncidentFingerprint(trace);
    const existing = grouped.get(fingerprint);
    if (existing) {
      existing.occurrenceCount += 1;
      existing.recentTraceIds = [trace.traceId, ...existing.recentTraceIds.filter((traceId) => traceId !== trace.traceId)].slice(0, 10);
      if ((trace.updatedAt ?? "") > (existing.lastSeenAt ?? "")) {
        Object.assign(existing, {
          ...trace,
          fingerprint,
          capturedAt: existing.capturedAt,
          lastSeenAt: trace.updatedAt ?? existing.lastSeenAt,
          occurrenceCount: existing.occurrenceCount,
          recentTraceIds: existing.recentTraceIds,
        });
      }
      continue;
    }

    grouped.set(fingerprint, {
      ...trace,
      fingerprint,
      capturedAt: trace.updatedAt ?? trace.createdAt ?? new Date().toISOString(),
      lastSeenAt: trace.updatedAt ?? trace.createdAt ?? new Date().toISOString(),
      occurrenceCount: 1,
      recentTraceIds: [trace.traceId],
    });
  }

  return [...grouped.values()].sort((left, right) => {
    const leftTime = left.lastSeenAt ?? left.capturedAt ?? "";
    const rightTime = right.lastSeenAt ?? right.capturedAt ?? "";
    return rightTime.localeCompare(leftTime);
  });
}

export function sanitizeConfigSnapshot(config) {
  if (!config || typeof config !== "object") {
    return {};
  }

  const source = config;
  const residentCore = typeof source.residentCore === "object" && source.residentCore ? source.residentCore : {};
  const channels = typeof residentCore.channels === "object" && residentCore.channels ? residentCore.channels : {};
  const legacyTelegram = typeof residentCore.telegram === "object" && residentCore.telegram ? residentCore.telegram : {};
  const telegram = typeof channels.telegram === "object" && channels.telegram
    ? channels.telegram
    : legacyTelegram;

  return {
    connectionType: source.connectionType ?? null,
    model: source.model ?? null,
    LETTA_BASE_URL: source.LETTA_BASE_URL ?? null,
    residentCore: {
      channels: {
        telegram: {
          configured: Boolean(telegram.token ?? telegram.botToken),
          dmPolicy: telegram.dmPolicy ?? null,
          streaming: telegram.streaming ?? null,
          workingDir: telegram.workingDir ?? null,
        },
      },
    },
  };
}

export function inferEnvironment(config, overrides = {}) {
  const connectionType = config?.connectionType ?? null;
  const model = config?.model ?? null;
  const telegramWorkingDir = config?.residentCore?.channels?.telegram?.workingDir
    ?? config?.residentCore?.telegram?.workingDir
    ?? null;
  return {
    surface: overrides.surface ?? "desktop",
    mode: overrides.mode ?? "unknown",
    connectionType,
    provider: overrides.provider ?? connectionType ?? "unknown",
    model,
    workingDir: overrides.workingDir
      ?? telegramWorkingDir
      ?? null,
    appVersion: overrides.appVersion ?? null,
    appRepoPath: overrides.appRepoPath ?? null,
  };
}

export function deriveIncidentTitle(summary, environment) {
  const surface = environment.surface ?? "system";
  const decision = summary.firstFailedDecisionId ?? summary.lastSuccessfulDecisionId ?? "unknown-step";
  const error = summary.errorCode ?? "unknown-error";
  return `${surface} incident at ${decision} (${error})`;
}

export function createIncidentPack({
  incident,
  primaryTrace,
  relatedTraces,
  environment,
  configSnapshot,
  paths = {},
}) {
  const canonicalTrace = primaryTrace ?? incident;
  const capturedAt = incident.capturedAt ?? canonicalTrace.updatedAt ?? new Date().toISOString();
  const traceIds = [incident.traceId, ...(incident.recentTraceIds ?? [])].filter(Boolean);

  return {
    schemaVersion: 1,
    id: `incident-${slugifyIncidentPart(incident.fingerprint)}-${slugifyIncidentPart(incident.traceId).slice(0, 12)}`,
    capturedAt,
    surface: environment.surface,
    mode: environment.mode,
    title: deriveIncidentTitle(incident, environment),
    fingerprint: incident.fingerprint,
    source: {
      incidentTraceId: incident.traceId,
      traceIds,
      userDataPath: paths.userDataPath ?? null,
      traceStoragePath: paths.traceStoragePath ?? null,
      incidentStoragePath: paths.incidentStoragePath ?? null,
    },
    diagnostics: {
      traceId: canonicalTrace.traceId,
      turnId: canonicalTrace.turnId ?? null,
      sessionId: canonicalTrace.sessionId ?? null,
      errorCode: canonicalTrace.errorCode ?? null,
      lastSuccessfulDecisionId: canonicalTrace.lastSuccessfulDecisionId ?? null,
      firstFailedDecisionId: canonicalTrace.firstFailedDecisionId ?? null,
      suggestedAction: canonicalTrace.suggestedAction ?? null,
      compactText: formatCompactDiagnostics(canonicalTrace),
      fullTraceText: formatFullTrace(canonicalTrace),
    },
    environment,
    configSnapshot,
    traces: {
      primary: canonicalTrace,
      related: relatedTraces,
    },
    incidentStats: {
      occurrenceCount: incident.occurrenceCount ?? 1,
      recentTraceIds: incident.recentTraceIds ?? [],
      lastSeenAt: incident.lastSeenAt ?? canonicalTrace.updatedAt ?? capturedAt,
    },
  };
}

export function resolveWorkspaceRoot(scriptDir) {
  return path.resolve(scriptDir, "../../..");
}
