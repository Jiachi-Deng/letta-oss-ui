import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadReleaseConfig, resolveReleaseConfigPath } from "./release-config.js";

const tempDirs = [];

function makeWorkspace() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "letta-release-config-test."));
  tempDirs.push(dir);
  return dir;
}

function makeFakeHome() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "letta-release-home-test."));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("release config resolver", () => {
  it("prefers explicit --config over workspace local config", () => {
    const workspaceRoot = makeWorkspace();
    const workspaceConfig = path.join(workspaceRoot, "release-config.local.json");
    const explicitConfig = path.join(workspaceRoot, "explicit.json");

    writeFileSync(workspaceConfig, JSON.stringify({
      connectionType: "anthropic-compatible",
      LETTA_BASE_URL: "https://workspace.example/v1",
      LETTA_API_KEY: "workspace-key",
      model: "MiniMax-M2.7",
    }));
    writeFileSync(explicitConfig, JSON.stringify({
      connectionType: "anthropic-compatible",
      LETTA_BASE_URL: "https://explicit.example/v1",
      LETTA_API_KEY: "explicit-key",
      model: "MiniMax-M2.7",
    }));

    const resolved = loadReleaseConfig({
      workspaceRoot,
      cliArgPath: explicitConfig,
      env: {},
      homeDir: makeFakeHome(),
    });

    expect(resolved.configPath).toBe(explicitConfig);
    expect(resolved.sourceLabel).toBe("--config");
    expect(resolved.baseUrl).toBe("https://explicit.example/v1");
  });

  it("uses workspace release-config.local.json before user app config fallback", () => {
    const workspaceRoot = makeWorkspace();
    const workspaceConfig = path.join(workspaceRoot, "release-config.local.json");

    writeFileSync(workspaceConfig, JSON.stringify({
      connectionType: "anthropic-compatible",
      LETTA_BASE_URL: "https://workspace.example/v1",
      LETTA_API_KEY: "workspace-key",
      model: "MiniMax-M2.7",
    }));

    const resolved = resolveReleaseConfigPath({
      workspaceRoot,
      env: {},
      homeDir: makeFakeHome(),
    });

    expect(resolved.configPath).toBe(workspaceConfig);
    expect(resolved.sourceLabel).toBe("workspace release-config.local.json");
  });

  it("explains how to create a workspace-local release config when none exists", () => {
    const workspaceRoot = makeWorkspace();

    expect(() => resolveReleaseConfigPath({
      workspaceRoot,
      env: {},
      homeDir: makeFakeHome(),
    })).toThrowError(
      /copy .*release-config\.example\.json .*release-config\.local\.json/i,
    );
  });
});
