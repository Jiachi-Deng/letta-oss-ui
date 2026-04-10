import type { RunnerHandle } from "../runner.js";

export class ResidentCoreRunnerRegistry {
  private readonly handles = new Map<string, RunnerHandle>();

  set(sessionId: string, handle: RunnerHandle): void {
    this.handles.set(sessionId, handle);
  }

  get(sessionId: string): RunnerHandle | undefined {
    return this.handles.get(sessionId);
  }

  delete(sessionId: string): void {
    this.handles.delete(sessionId);
  }

  entries(): Array<[string, RunnerHandle]> {
    return [...this.handles.entries()];
  }

  clear(): void {
    this.handles.clear();
  }
}

export function createResidentCoreRunnerRegistry(): ResidentCoreRunnerRegistry {
  return new ResidentCoreRunnerRegistry();
}
