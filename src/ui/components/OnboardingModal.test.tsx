// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingModal } from "./OnboardingModal";

describe("OnboardingModal", () => {
  const saveAppConfigMock = vi.fn();
  const onSavedMock = vi.fn();

  beforeEach(() => {
    saveAppConfigMock.mockReset();
    onSavedMock.mockReset();

    Object.defineProperty(window, "electron", {
      value: {
        saveAppConfig: saveAppConfigMock,
      },
      configurable: true,
    });
  });

  function makeConfigState(overrides?: Partial<Awaited<ReturnType<Window["electron"]["getAppConfig"]>>>) {
    return {
      mode: "packaged",
      source: "packaged-config",
      config: {
        connectionType: "letta-server",
        LETTA_BASE_URL: "https://api.letta.com",
        LETTA_API_KEY: "api-key",
        model: "MiniMax-M2.7",
        residentCore: {
          channels: {
            telegram: {
              token: "telegram-token",
              dmPolicy: "allowlist",
              streaming: false,
              workingDir: "/tmp/project",
            },
          },
        },
      },
      canEdit: true,
      requiresOnboarding: false,
      ...overrides,
    } as Awaited<ReturnType<Window["electron"]["getAppConfig"]>>;
  }

  it("fills and saves Telegram settings through the channels container", async () => {
    const user = userEvent.setup();
    const configState = makeConfigState();
    const nextState = makeConfigState();
    saveAppConfigMock.mockResolvedValue(nextState);

    render(<OnboardingModal configState={configState} onSaved={onSavedMock} mode="settings" />);

    expect(screen.getByText("Channels")).toBeInTheDocument();
    expect(screen.getByText("Telegram available now")).toBeInTheDocument();
    expect(screen.getByLabelText("Bot Token")).toHaveValue("telegram-token");
    expect(screen.getByLabelText("DM Policy")).toHaveValue("allowlist");
    expect(screen.getByRole("checkbox", { name: /Streaming/ })).not.toBeChecked();
    expect(screen.getByLabelText("Working Directory")).toHaveValue("/tmp/project");

    await user.clear(screen.getByLabelText("Bot Token"));
    await user.type(screen.getByLabelText("Bot Token"), "  new-token  ");
    await user.selectOptions(screen.getByLabelText("DM Policy"), "open");
    await user.click(screen.getByRole("checkbox", { name: /Streaming/ }));
    await user.clear(screen.getByLabelText("Working Directory"));
    await user.type(screen.getByLabelText("Working Directory"), "  /Users/jachi/Desktop/letta-workspace  ");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(saveAppConfigMock).toHaveBeenCalledTimes(1));
    expect(saveAppConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      residentCore: {
        channels: {
          telegram: {
            token: "new-token",
            dmPolicy: "open",
            streaming: true,
            workingDir: "/Users/jachi/Desktop/letta-workspace",
          },
        },
      },
    }));
    expect(onSavedMock).toHaveBeenCalledWith(nextState);
  });

  it("stores Telegram as unconfigured when token is blank and defaults are untouched", async () => {
    const user = userEvent.setup();
    const configState = makeConfigState({
      config: {
        connectionType: "letta-server",
        LETTA_BASE_URL: "https://api.letta.com",
        LETTA_API_KEY: "api-key",
        model: "MiniMax-M2.7",
        residentCore: {
          channels: {
            telegram: null,
          },
        },
      },
    });
    const nextState = makeConfigState({
      config: {
        connectionType: "letta-server",
        LETTA_BASE_URL: "https://api.letta.com",
        LETTA_API_KEY: "api-key",
        model: "MiniMax-M2.7",
      },
    });
    saveAppConfigMock.mockResolvedValue(nextState);

    render(<OnboardingModal configState={configState} onSaved={onSavedMock} mode="settings" />);

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(saveAppConfigMock).toHaveBeenCalledTimes(1));
    expect(saveAppConfigMock).toHaveBeenCalledWith(expect.objectContaining({
      residentCore: {
        channels: {
          telegram: null,
        },
      },
    }));
  });

  it("keeps the modal panel capped with a scrollable body and visible actions", () => {
    const configState = makeConfigState();

    render(<OnboardingModal configState={configState} onSaved={onSavedMock} mode="settings" onClose={vi.fn()} />);

    expect(screen.getByTestId("onboarding-modal-panel")).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("onboarding-modal-panel")).toHaveClass("max-h-[calc(100dvh-2rem)]");
    expect(screen.getByTestId("onboarding-modal-scroll-body")).toHaveClass("overflow-y-auto");
    expect(screen.getByRole("button", { name: "Close settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
    expect(screen.getByText(/Telegram is the first supported channel in this build/i)).toBeInTheDocument();
  });
});
