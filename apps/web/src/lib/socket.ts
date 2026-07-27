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

interface TagValueUpdatedPayload {
  machineId: string;
  values: { tagName: string; value: string; timestamp: string }[];
}

interface TagLike {
  name: string;
  lastValue?: string | null;
  lastValueAt?: string | null;
}

/**
 * Automation Gateway: `tag.value.updated` event'ini dinleyip, ilgili makinenin tag
 * listesi önbelleğini refetch YAPMADAN doğrudan günceller — mevcut `useInvalidateOn`
 * deseninden bilinçli sapma, çünkü tag akışı yüksek frekanslı olabilir.
 */
export function useTagValues(machineId: string | null, queryKey: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!machineId) return;
    const s = getSocket();
    const handler = (payload: TagValueUpdatedPayload) => {
      if (payload.machineId !== machineId) return;
      qc.setQueryData<TagLike[]>([queryKey], (old) => {
        if (!old) return old;
        return old.map((tag) => {
          const match = payload.values.find((v) => v.tagName === tag.name);
          return match ? { ...tag, lastValue: match.value, lastValueAt: match.timestamp } : tag;
        });
      });
    };
    s.on("tag.value.updated", handler);
    return () => {
      s.off("tag.value.updated", handler);
    };
  }, [machineId, queryKey, qc]);
}
