import type { AppConfigState } from "../config.js";
import { getAppConfigState } from "../config.js";
import {
  prepareRuntimeConnection,
  type RuntimeConnectionInfo,
} from "../provider-bootstrap.js";

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
    prepareRuntimeConnection,
  };
}
