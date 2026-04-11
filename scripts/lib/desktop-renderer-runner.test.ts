import { describe, expect, it } from "vitest";
import {
  applySeedFiles,
  buildIsolatedAppConfig,
  extractFirstMessage,
} from "./desktop-renderer-runner.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("desktop-renderer-runner", () => {
  it("extracts the first message from a send_message step", () => {
    expect(
      extractFirstMessage({
        id: "case-1",
        steps: [{ action: "launch_app" }, { action: "send_message", value: "你好" }],
      }),
    ).toBe("你好");
  });

  it("builds an isolated compatible config from the source config", () => {
    const config = buildIsolatedAppConfig({
      evalCase: {
        setup: {
          configPreset: "compatible-minimax",
        },
      },
      sourceConfig: {
        connectionType: "anthropic-compatible",
        LETTA_BASE_URL: "https://api.minimax.chat/anthropic",
        LETTA_API_KEY: "mini-key",
        model: "lc-minimax/MiniMax-M2.7",
      },
    });

    expect(config).toEqual({
      connectionType: "anthropic-compatible",
      LETTA_BASE_URL: "https://api.minimax.chat/anthropic",
      LETTA_API_KEY: "mini-key",
      model: "lc-minimax/MiniMax-M2.7",
      residentCore: {},
    });
  });

  it("writes seed files into the working directory", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "letta-renderer-seed."));
    try {
      applySeedFiles(tempDir, [
        { path: "notes.txt", content: "hello\nworld" },
        { path: "nested/info.md", content: "# title" },
      ]);

      expect(fs.readFileSync(path.join(tempDir, "notes.txt"), "utf8")).toBe("hello\nworld");
      expect(fs.readFileSync(path.join(tempDir, "nested/info.md"), "utf8")).toBe("# title");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
