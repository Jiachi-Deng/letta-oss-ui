export const IPC_START_001 = "IPC_START_001";
export const IPC_CONTINUE_001 = "IPC_CONTINUE_001";
export const RUNNER_INIT_001 = "RUNNER_INIT_001";
export const RUNNER_INIT_002 = "RUNNER_INIT_002";
export const BOOT_CONN_001 = "BOOT_CONN_001";
export const BOOT_CONN_002 = "BOOT_CONN_002";
export const CI_BOOT_001 = "CI_BOOT_001";
export const CI_BOOT_002 = "CI_BOOT_002";
export const CI_BOOT_003 = "CI_BOOT_003";
export const CI_BOOT_004 = "CI_BOOT_004";
export const STREAM_001 = "STREAM_001";
export const STREAM_002 = "STREAM_002";

export const DECISION_IDS = {
  IPC_START_001,
  IPC_CONTINUE_001,
  RUNNER_INIT_001,
  RUNNER_INIT_002,
  BOOT_CONN_001,
  BOOT_CONN_002,
  CI_BOOT_001,
  CI_BOOT_002,
  CI_BOOT_003,
  CI_BOOT_004,
  STREAM_001,
  STREAM_002,
} as const;

export type DecisionId = (typeof DECISION_IDS)[keyof typeof DECISION_IDS];

const DECISION_ID_VALUES = new Set<DecisionId>(Object.values(DECISION_IDS));

export function isDecisionId(value: unknown): value is DecisionId {
  return typeof value === "string" && DECISION_ID_VALUES.has(value as DecisionId);
}
