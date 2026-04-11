import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectForbiddenBundledServerEntries,
  resolveBundledServerSizeBudgetMb,
  verifyBundledServerSizeBudget,
} from "../release-check.mjs";

const tempDirs = [];

function makeServerRoot() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "letta-release-check-test."));
  tempDirs.push(dir);
  return dir;
}

function writeFile(targetPath, contents = "x") {
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, contents);
}

afterEach(() => {
  delete process.env.LETTA_SERVER_SIZE_BUDGET_MB;
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("release-check bundled server guardrails", () => {
  it("uses the telegram-lite size budget by default", () => {
    expect(resolveBundledServerSizeBudgetMb("telegram-lite")).toBe(475);
  });

  it("honors an explicit size budget override", () => {
    process.env.LETTA_SERVER_SIZE_BUDGET_MB = "12";
    expect(resolveBundledServerSizeBudgetMb("telegram-lite")).toBe(12);
  });

  it("detects forbidden bundled content from the prune plan", () => {
    const serverRoot = makeServerRoot();
    writeFile(path.join(serverRoot, "app", "letta", "personas", "examples", "sqldb", "test.db"));
    writeFile(path.join(serverRoot, "venv", "lib", "python3.11", "site-packages", "pip", "__init__.py"));
    writeFile(path.join(serverRoot, "venv", "lib", "python3.11", "site-packages", "temporalio-1.0.0.dist-info", "METADATA"));
    writeFile(path.join(serverRoot, "python-base", "Python.framework", "Versions", "3.11", "lib", "python3.11", "ensurepip", "__init__.py"));
    writeFile(path.join(serverRoot, "venv", "bin", "pip3"));

    const forbidden = collectForbiddenBundledServerEntries(serverRoot, "telegram-lite");

    expect(forbidden).toEqual(expect.arrayContaining([
      path.join(serverRoot, "app", "letta", "personas", "examples", "sqldb", "test.db"),
      path.join(serverRoot, "venv", "lib", "python3.11", "site-packages", "pip"),
      path.join(serverRoot, "venv", "lib", "python3.11", "site-packages", "temporalio-1.0.0.dist-info"),
      path.join(serverRoot, "python-base", "Python.framework", "Versions", "3.11", "lib", "python3.11", "ensurepip"),
      path.join(serverRoot, "venv", "bin", "pip3"),
    ]));
  });

  it("fails when the bundled server exceeds the configured budget", () => {
    const serverRoot = makeServerRoot();
    process.env.LETTA_SERVER_SIZE_BUDGET_MB = "1";
    writeFile(path.join(serverRoot, "payload.bin"), Buffer.alloc(2 * 1024 * 1024, 1));

    expect(() => verifyBundledServerSizeBudget(serverRoot, "telegram-lite")).toThrow(/exceeds telegram-lite budget 1MB/);
  });
});
