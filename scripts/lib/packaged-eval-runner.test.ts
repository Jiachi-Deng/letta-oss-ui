import { describe, expect, it } from "vitest";
import { resolvePresetRuntimeConfig } from "./packaged-eval-runner.js";

describe("packaged eval runner", () => {
  it("maps compatible minimax presets onto anthropic-compatible provider bootstrap", () => {
    const config = resolvePresetRuntimeConfig("compatible-minimax", {
      connectionType: "anthropic-compatible",
      LETTA_BASE_URL: "https://api.example.com/anthropic",
      LETTA_API_KEY: "sk-test",
      model: "MiniMax-M2.7",
    });

    expect(config).toMatchObject({
      connectionType: "anthropic-compatible",
      baseUrl: "https://api.example.com/anthropic",
      apiKey: "sk-test",
      model: "MiniMax-M2.7",
    });
  });

  it("throws when compatible minimax preset has no minimax model", () => {
    expect(() =>
      resolvePresetRuntimeConfig("compatible-minimax", {
        connectionType: "anthropic-compatible",
        LETTA_BASE_URL: "https://api.example.com/anthropic",
        LETTA_API_KEY: "sk-test",
        model: "claude-3-5-sonnet",
      }),
    ).toThrow(/MiniMax model/);
  });
});
