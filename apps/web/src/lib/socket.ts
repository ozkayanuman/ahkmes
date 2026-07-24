import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { io, type Socket } from "socket.io-client";
import { getTokens } from "./api";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_URL, { auth: { token: getTokens().access } });
  }
  return socket;
}

/** Verilen olaylar geldiğinde react-query önbelleklerini tazeler (canlı liste/stok). */
export function useInvalidateOn(events: string[], queryKeys: string[]) {
  const qc = useQueryClient();
  useEffect(() => {
    const s = getSocket();
    const handler = () => {
      for (const key of queryKeys) qc.invalidateQueries({ queryKey: [key] });
    };
    for (const e of events) s.on(e, handler);
    return () => {
      for (const e of events) s.off(e, handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join("|"), queryKeys.join("|"), qc]);
}
