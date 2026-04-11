import { useCallback, useEffect, useRef } from "react";
import type { ServerEvent, ClientEvent } from "../types";

export function useIPC(onEvent: (event: ServerEvent) => void) {
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Subscribe to server events
    const unsubscribe = window.electron.onServerEvent((event: ServerEvent) => {
      onEvent(event);
    });
    
    unsubscribeRef.current = unsubscribe;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [onEvent]);

  const sendEvent = useCallback((event: ClientEvent) => {
    window.electron.sendClientEvent(event);
  }, []);

  return { connected: true, sendEvent };
}
