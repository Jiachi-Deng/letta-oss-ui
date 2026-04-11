// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/useAppStore";
import { Sidebar } from "./Sidebar";

function resetAppStore() {
  useAppStore.setState({
    sessions: {},
    activeSessionId: null,
    activeAgentKey: "primary",
    activeAgent: {
      agentId: "agent-primary-123456",
      name: "Companion",
      lastUsedAt: "2026-04-10T19:00:00.000Z",
      conversationMode: "shared",
    },
    knownAgents: [
      {
        key: "primary",
        record: {
          agentId: "agent-primary-123456",
          name: "Companion",
          lastUsedAt: "2026-04-10T19:00:00.000Z",
          conversationMode: "shared",
        },
      },
      {
        key: "work",
        record: {
          agentId: "agent-work-abcdef",
          lastUsedAt: "2026-04-10T19:05:00.000Z",
        },
      },
    ],
    agentSwitchError: null,
    agentMutationError: null,
    prompt: "",
    cwd: "",
    pendingStart: false,
    globalError: null,
    sessionsLoaded: false,
    showStartModal: false,
    historyRequested: new Set(),
  });
}

describe("Sidebar agent control", () => {
  beforeEach(() => {
    resetAppStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches create, rename, and delete actions from the active agent card", async () => {
    const user = userEvent.setup();
    const onAgentCreate = vi.fn();
    const onAgentRename = vi.fn();
    const onAgentDelete = vi.fn();

    render(
      <Sidebar
        connected={true}
        onNewSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onAgentSwitch={vi.fn()}
        onAgentCreate={onAgentCreate}
        onAgentRename={onAgentRename}
        onAgentDelete={onAgentDelete}
        activeView="chat"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create agent" }));
    await user.type(screen.getByLabelText("Create agent name"), "Research");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onAgentCreate).toHaveBeenCalledWith("Research");

    await user.click(screen.getByRole("button", { name: "Rename active" }));
    const renameInput = screen.getByLabelText("Rename active agent name");
    expect(renameInput).toHaveValue("Companion");
    await user.clear(renameInput);
    await user.type(renameInput, "Companion Plus");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onAgentRename).toHaveBeenCalledWith("primary", "Companion Plus");

    await user.click(screen.getByRole("button", { name: "Delete active" }));

    expect(onAgentDelete).toHaveBeenCalledWith("primary");
  });

  it("blocks deleting the last known agent", async () => {
    useAppStore.setState({
      knownAgents: [
        {
          key: "primary",
          record: {
            agentId: "agent-primary-123456",
            name: "Companion",
            lastUsedAt: "2026-04-10T19:00:00.000Z",
            conversationMode: "shared",
          },
        },
      ],
    });

    render(
      <Sidebar
        connected={true}
        onNewSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onAgentSwitch={vi.fn()}
        onAgentCreate={vi.fn()}
        onAgentRename={vi.fn()}
        onAgentDelete={vi.fn()}
        activeView="chat"
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "Delete active" });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute("title", "Keep at least one agent before deleting.");
  });

  it("dispatches an agent switch when another agent is selected", async () => {
    const user = userEvent.setup();
    const onAgentSwitch = vi.fn();

    render(
      <Sidebar
        connected={true}
        onNewSession={vi.fn()}
        onDeleteSession={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenDiagnostics={vi.fn()}
        onAgentSwitch={onAgentSwitch}
        onAgentCreate={vi.fn()}
        onAgentRename={vi.fn()}
        onAgentDelete={vi.fn()}
        activeView="chat"
      />,
    );

    expect(screen.getByText(/Companion/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Switch active agent"), "work");

    expect(onAgentSwitch).toHaveBeenCalledWith("work");
  });
});
