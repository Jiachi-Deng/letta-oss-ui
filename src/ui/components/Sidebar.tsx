import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Dialog from "@radix-ui/react-dialog";
import { useAppStore } from "../store/useAppStore";

interface SidebarProps {
  connected: boolean;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenDiagnostics: () => void;
  onAgentSwitch: (agentKey: string) => void;
  onAgentCreate: (name?: string) => void;
  onAgentRename: (agentKey: string, name: string) => void;
  onAgentDelete: (agentKey: string) => void;
  activeView: "chat" | "diagnostics";
}

export function Sidebar({
  connected,
  onNewSession,
  onDeleteSession,
  onOpenSettings,
  onOpenDiagnostics,
  onAgentSwitch,
  onAgentCreate,
  onAgentRename,
  onAgentDelete,
  activeView,
}: SidebarProps) {
  const sessions = useAppStore((state) => state.sessions);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const setActiveSessionId = useAppStore((state) => state.setActiveSessionId);
  const activeAgentKey = useAppStore((state) => state.activeAgentKey);
  const activeAgent = useAppStore((state) => state.activeAgent);
  const knownAgents = useAppStore((state) => state.knownAgents);
  const agentSwitchError = useAppStore((state) => state.agentSwitchError);
  const agentMutationError = useAppStore((state) => state.agentMutationError);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);
  const [agentEditorMode, setAgentEditorMode] = useState<"create" | "rename" | null>(null);
  const [agentDraftName, setAgentDraftName] = useState("");
  const [copied, setCopied] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const formatCwd = (cwd?: string) => {
    if (!cwd) return "Working dir unavailable";
    const parts = cwd.split(/[\\/]+/).filter(Boolean);
    const tail = parts.slice(-2).join("/");
    return `/${tail || cwd}`;
  };

  const sessionList = useMemo(() => {
    const list = Object.values(sessions);
    list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return list;
  }, [sessions]);

  const activeAgentDisplay = useMemo(() => {
    if (!activeAgentKey) return "Waiting for agent info";
    const displayName = activeAgent?.name?.trim() || activeAgentKey;
    const shortAgentId = activeAgent?.agentId
      ? `${activeAgent.agentId.slice(0, 8)}${activeAgent.agentId.length > 8 ? "…" : ""}`
      : null;
    return shortAgentId ? `${displayName} · ${shortAgentId}` : displayName;
  }, [activeAgent, activeAgentKey]);

  const selectedAgentKey = useMemo(() => {
    if (!activeAgentKey) return "";
    return knownAgents.some((agent) => agent.key === activeAgentKey) ? activeAgentKey : "";
  }, [activeAgentKey, knownAgents]);

  const agentActionError = agentMutationError || agentSwitchError;
  const canEditActiveAgent = connected && Boolean(activeAgentKey);
  const canDeleteActiveAgent = connected && Boolean(activeAgentKey) && knownAgents.length > 1;

  useEffect(() => {
    if (!agentEditorMode) {
      setAgentDraftName("");
      return;
    }

    if (agentEditorMode === "create") {
      setAgentDraftName("");
      return;
    }

    setAgentDraftName(activeAgent?.name?.trim() || activeAgentKey || "");
  }, [agentEditorMode, activeAgent?.name, activeAgentKey]);

  useEffect(() => {
    setCopied(false);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, [resumeSessionId]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const handleCopyCommand = async () => {
    if (!resumeSessionId) return;
    const command = `letta --conv ${resumeSessionId}`;
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setResumeSessionId(null);
    }, 3000);
  };

  const handleSubmitAgentEditor = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = agentDraftName.trim();

    if (agentEditorMode === "rename") {
      if (!activeAgentKey || !nextName) return;
      onAgentRename(activeAgentKey, nextName);
    } else if (agentEditorMode === "create") {
      onAgentCreate(nextName || undefined);
    }

    setAgentEditorMode(null);
    setAgentDraftName("");
  };

  const handleDeleteActiveAgent = () => {
    if (!canDeleteActiveAgent || !activeAgentKey) return;
    onAgentDelete(activeAgentKey);
  };

  return (
    <aside className="fixed inset-y-0 left-0 flex h-full w-[280px] flex-col gap-4 border-r border-border bg-sidebar px-4 pb-4 pt-12">
      <div 
        className="absolute top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="flex gap-2">
        <button
          className="flex-1 rounded-xl border border-ink-900/10 bg-surface px-4 py-2.5 text-sm font-medium text-ink-700 hover:bg-surface-tertiary hover:border-ink-900/20 transition-colors"
          onClick={onNewSession}
        >
          + New Task
        </button>
      </div>
      <div className="rounded-xl border border-ink-900/10 bg-surface px-3 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Active Agent</div>
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink-800">{activeAgentDisplay}</div>
            <div className="truncate text-[11px] text-muted">
              {activeAgent?.agentId ? `ID ${activeAgent.agentId}` : "No durable agent loaded"}
            </div>
          </div>
          <select
            aria-label="Switch active agent"
            className="max-w-[120px] rounded-lg border border-ink-900/10 bg-surface-secondary px-2 py-1 text-xs text-ink-700 outline-none transition-colors hover:border-ink-900/20 focus:border-accent"
            value={selectedAgentKey}
            onChange={(event) => {
              const nextKey = event.target.value;
              if (!nextKey || nextKey === activeAgentKey) return;
              onAgentSwitch(nextKey);
            }}
            disabled={!connected || knownAgents.length === 0}
          >
            {knownAgents.length === 0 ? (
              <option value="">No agents</option>
            ) : (
              <>
                <option value="">Select agent…</option>
                {knownAgents.map((agent) => {
                  const shortId = agent.record.agentId.slice(0, 8);
                  return (
                    <option key={agent.key} value={agent.key}>
                      {agent.key} · {shortId}
                    </option>
                  );
                })}
              </>
            )}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-ink-900/10 bg-surface-secondary px-2.5 py-1.5 text-[11px] font-medium text-ink-700 transition-colors hover:border-ink-900/20 hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => setAgentEditorMode("create")}
            disabled={!connected}
          >
            Create agent
          </button>
          <button
            className="rounded-lg border border-ink-900/10 bg-surface-secondary px-2.5 py-1.5 text-[11px] font-medium text-ink-700 transition-colors hover:border-ink-900/20 hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => {
              if (!activeAgentKey) return;
              setAgentEditorMode("rename");
            }}
            disabled={!canEditActiveAgent}
          >
            Rename active
          </button>
          <button
            className="rounded-lg border border-ink-900/10 bg-surface-secondary px-2.5 py-1.5 text-[11px] font-medium text-ink-700 transition-colors hover:border-ink-900/20 hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={handleDeleteActiveAgent}
            disabled={!canDeleteActiveAgent}
            title={knownAgents.length <= 1 ? "Keep at least one agent before deleting." : undefined}
          >
            Delete active
          </button>
        </div>
        {agentEditorMode && (
          <form className="mt-3 rounded-xl border border-ink-900/10 bg-surface-secondary p-3" onSubmit={handleSubmitAgentEditor}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              {agentEditorMode === "create" ? "Create agent" : "Rename active agent"}
            </div>
            <input
              autoFocus
              aria-label={agentEditorMode === "create" ? "Create agent name" : "Rename active agent name"}
              className="mt-2 w-full rounded-lg border border-ink-900/10 bg-surface px-3 py-2 text-sm text-ink-800 outline-none transition-colors placeholder:text-muted focus:border-accent"
              placeholder={agentEditorMode === "create" ? "Optional agent name" : "Agent name"}
              value={agentDraftName}
              onChange={(event) => setAgentDraftName(event.target.value)}
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-ink-900/10 bg-surface px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:border-ink-900/20 hover:bg-surface-tertiary"
                onClick={() => {
                  setAgentEditorMode(null);
                  setAgentDraftName("");
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg border border-accent/20 bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={agentEditorMode === "rename" && !agentDraftName.trim()}
              >
                Save
              </button>
            </div>
          </form>
        )}
        {agentActionError && (
          <div className="mt-2 text-[11px] text-error" role="alert">
            {agentActionError}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {sessionList.length === 0 && (
          <div className="rounded-xl border border-ink-900/5 bg-surface px-4 py-5 text-center text-xs text-muted">
            No sessions yet. Click "+ New Task" to start.
          </div>
        )}
        {sessionList.map((session) => (
          <div
            key={session.id}
            className={`cursor-pointer rounded-xl border px-2 py-3 text-left transition ${activeSessionId === session.id ? "border-accent/30 bg-accent-subtle" : "border-ink-900/5 bg-surface hover:bg-surface-tertiary"}`}
            onClick={() => setActiveSessionId(session.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveSessionId(session.id); } }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col min-w-0 flex-1 overflow-hidden">
                <div className={`text-[12px] font-medium ${session.status === "running" ? "text-info" : session.status === "completed" ? "text-success" : session.status === "error" ? "text-error" : "text-ink-800"}`}>
                  {session.title}
                </div>
                <div className="flex items-center justify-between mt-0.5 text-xs text-muted">
                  <span className="truncate">{formatCwd(session.cwd)}</span>
                </div>
              </div>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button className="flex-shrink-0 rounded-full p-1.5 text-ink-500 hover:bg-ink-900/10" aria-label="Open session menu" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                      <circle cx="5" cy="12" r="1.7" />
                      <circle cx="12" cy="12" r="1.7" />
                      <circle cx="19" cy="12" r="1.7" />
                    </svg>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="z-50 min-w-[220px] rounded-xl border border-ink-900/10 bg-surface p-1 shadow-lg" align="center" sideOffset={8}>
                    <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5" onSelect={() => onDeleteSession(session.id)}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-error/80" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M7 7l1 12a1 1 0 0 0 1 .9h6a1 1 0 0 0 1-.9l1-12" />
                      </svg>
                      Delete this session
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 outline-none hover:bg-ink-900/5" onSelect={() => setResumeSessionId(session.id)}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M4 5h16v14H4z" /><path d="M7 9h10M7 12h6" /><path d="M13 15l3 2-3 2" />
                      </svg>
                      Resume in Letta Code
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-ink-900/5 pt-3">
        <button
          className={`mb-2 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
            activeView === "diagnostics"
              ? "border-accent/30 bg-accent-subtle text-ink-800"
              : "border-ink-900/10 bg-surface text-ink-700 hover:bg-surface-tertiary hover:border-ink-900/20"
          }`}
          onClick={onOpenDiagnostics}
        >
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 19h16M7 15V9m5 6V5m5 10v-4" />
            </svg>
            <span>Diagnostics</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
        <button
          className="flex w-full items-center justify-between rounded-xl border border-ink-900/10 bg-surface px-3 py-2.5 text-left text-sm text-ink-700 transition-colors hover:bg-surface-tertiary hover:border-ink-900/20"
          onClick={onOpenSettings}
        >
          <span className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 3l1.6 2.5 2.9.6-.9 2.8 1.9 2.2-2.2 1.9.9 2.8-2.9.6L12 21l-1.6-2.5-2.9-.6.9-2.8-1.9-2.2 2.2-1.9-.9-2.8 2.9-.6z" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
            <span>Settings</span>
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <Dialog.Root open={!!resumeSessionId} onOpenChange={(open) => !open && setResumeSessionId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-ink-900/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-full max-w-xl -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <Dialog.Title className="text-lg font-semibold text-ink-800">Resume</Dialog.Title>
              <Dialog.Close asChild>
                <button className="rounded-full p-1 text-ink-500 hover:bg-ink-900/10" aria-label="Close dialog">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 6l12 12M18 6l-12 12" />
                  </svg>
                </button>
              </Dialog.Close>
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-ink-900/10 bg-surface px-3 py-2 font-mono text-xs text-ink-700">
              <span className="flex-1 break-all">{resumeSessionId ? `letta --conv ${resumeSessionId}` : ""}</span>
              <button className="rounded-lg p-1.5 text-ink-600 hover:bg-ink-900/10" onClick={handleCopyCommand} aria-label="Copy resume command">
                {copied ? (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12l4 4L19 6" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                )}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </aside>
  );
}
