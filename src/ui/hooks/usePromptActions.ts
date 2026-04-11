import { useCallback } from "react";
import type { ClientEvent } from "../types";
import { useAppStore } from "../store/useAppStore";

export function usePromptActions(sendEvent: (event: ClientEvent) => void) {
  const prompt = useAppStore((state) => state.prompt);
  const cwd = useAppStore((state) => state.cwd);
  const activeSessionId = useAppStore((state) => state.activeSessionId);
  const sessions = useAppStore((state) => state.sessions);
  const setPrompt = useAppStore((state) => state.setPrompt);
  const setPendingStart = useAppStore((state) => state.setPendingStart);
  const setGlobalError = useAppStore((state) => state.setGlobalError);

  const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
  const isRunning = activeSession?.status === "running";

  const handleSend = useCallback(async () => {
    if (!prompt.trim()) return;

    if (!activeSessionId) {
      setPendingStart(true);
      sendEvent({
        type: "session.start",
        payload: { title: "", prompt, cwd: cwd.trim() || undefined },
      });
      return;
    }

    if (activeSession?.status === "running") {
      setGlobalError("Session is still running. Please wait for it to finish.");
      return;
    }

    sendEvent({
      type: "session.continue",
      payload: { sessionId: activeSessionId, prompt, cwd: activeSession?.cwd },
    });
    setPrompt("");
  }, [activeSession, activeSessionId, cwd, prompt, sendEvent, setGlobalError, setPendingStart, setPrompt]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    sendEvent({ type: "session.stop", payload: { sessionId: activeSessionId } });
  }, [activeSessionId, sendEvent]);

  const handleStartFromModal = useCallback(() => {
    if (!cwd.trim()) {
      setGlobalError("Working Directory is required to start a session.");
      return;
    }
    handleSend();
  }, [cwd, handleSend, setGlobalError]);

  return { prompt, setPrompt, isRunning, handleSend, handleStop, handleStartFromModal };
}
