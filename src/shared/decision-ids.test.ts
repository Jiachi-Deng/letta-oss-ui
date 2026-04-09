import { describe, expect, it } from "vitest";
import {
  BOOT_CONN_001,
  BOOT_CONN_002,
  CI_BOOT_001,
  CI_BOOT_002,
  CI_BOOT_003,
  CI_BOOT_004,
  DECISION_IDS,
  IPC_CONTINUE_001,
  IPC_START_001,
  RUNNER_INIT_001,
  RUNNER_INIT_002,
  STREAM_001,
  STREAM_002,
  isDecisionId,
} from "./decision-ids.js";

describe("decision ids", () => {
  it("exports the stable v1/v2 observability decision catalog", () => {
    expect(DECISION_IDS).toMatchObject({
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
    });
  });

  it("validates known decision ids", () => {
    expect(isDecisionId(RUNNER_INIT_001)).toBe(true);
    expect(isDecisionId("NOT_A_REAL_DECISION")).toBe(false);
  });
});
