import { describe, expect, it } from "vitest";
import { normalizeSDKMessageForApp } from "./message-normalizer.js";

describe("message normalizer", () => {
  it("flattens structured assistant content at the app boundary", () => {
    const normalized = normalizeSDKMessageForApp({
      type: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ],
      uuid: "msg-1",
    } as never);

    expect(normalized).toMatchObject({
      type: "assistant",
      content: "Hello world",
      uuid: "msg-1",
    });
  });
});
