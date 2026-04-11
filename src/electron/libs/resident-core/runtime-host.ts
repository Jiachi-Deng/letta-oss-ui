import type { AppConfigState } from "../config.js";
import { getAppConfigState } from "../config.js";
import {
  prepareRuntimeConnection,
  type RuntimeConnectionInfo as ProviderRuntimeConnectionInfo,
} from "../provider-bootstrap.js";
import { createComponentLogger, createTraceContext, createTurnId } from "../trace.js";
import {
  RC_RUNTIME_PREP_001,
  RC_RUNTIME_PREP_002,
  RC_RUNTIME_PREP_003,
} from "../../../shared/decision-ids.js";
import { E_RESIDENT_CORE_RUNTIME_PREP_FAILED } from "../../../shared/error-codes.js";

export type RuntimeConnectionInfo = ProviderRuntimeConnectionInfo;

const log = createComponentLogger("resident-core-runtime-host");

export type ResidentCoreRuntimeHost = {
  getAppConfigState: () => AppConfigState;
  prepareRuntimeConnection: (
    config: Parameters<typeof prepareRuntimeConnection>[0],
    traceContext: Parameters<typeof prepareRuntimeConnection>[1],
  ) => Promise<RuntimeConnectionInfo>;
};

export function createResidentCoreRuntimeHost(): ResidentCoreRuntimeHost {
  return {
    getAppConfigState,
    async prepareRuntimeConnection(config, traceContext) {
      const context = traceContext ?? createTraceContext({ turnId: createTurnId() });
      log({
        level: "info",
        message: "Resident Core runtime preparation entered",
        decision_id: RC_RUNTIME_PREP_001,
        trace_id: context.traceId,
        turn_id: context.turnId,
        session_id: context.sessionId,
        data: {
          connectionType: (config as { connectionType?: string }).connectionType,
        },
      });
      try {
        const runtimeConnection = await prepareRuntimeConnection(config, context);
        log({
          level: "info",
          message: "Resident Core runtime preparation resolved",
          decision_id: RC_RUNTIME_PREP_002,
          trace_id: context.traceId,
          turn_id: context.turnId,
          session_id: context.sessionId,
          data: {
            baseUrl: runtimeConnection.baseUrl,
            modelHandle: runtimeConnection.modelHandle,
            bootstrapKind: runtimeConnection.bootstrapAction.kind,
          },
        });
        return runtimeConnection;
      } catch (error) {
        log({
          level: "error",
          message: "Resident Core runtime preparation failed",
          decision_id: RC_RUNTIME_PREP_003,
          error_code: E_RESIDENT_CORE_RUNTIME_PREP_FAILED,
          trace_id: context.traceId,
          turn_id: context.turnId,
          session_id: context.sessionId,
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
  };
}
