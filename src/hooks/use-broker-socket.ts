"use client";
import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type { BrokerStats } from "@/lib/eco";

/**
 * Live broker stats over socket.io. The broker mini-service listens on port
 * 3002 and is reached from the browser through the Caddy gateway using the
 * `XTransformPort` query param (path ALWAYS "/", per the gateway contract).
 *
 * The broker emits a `stats` event on connect + every 1s + on every state
 * change (publish/ack/nack). We also subscribe to the `transactions` topic
 * room so we get `message` / `ack` / `nack` events for the live activity feed.
 */
export function useBrokerSocket(enabled: boolean) {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<BrokerStats | null>(null);
  const [events, setEvents] = useState<{ ts: number; kind: string; text: string }[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const socket = io("/?XTransformPort=3002", {
      transports: ["websocket", "polling"],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 10000,
    });
    socketRef.current = socket;

    const pushEvent = (kind: string, text: string) => {
      setEvents((prev) => {
        const next = [{ ts: Date.now(), kind, text }, ...prev];
        return next.slice(0, 50);
      });
    };

    socket.on("connect", () => {
      setConnected(true);
      pushEvent("connect", "Connected to message broker");
      socket.emit("subscribe", { topic: "transactions" });
    });
    socket.on("disconnect", () => {
      setConnected(false);
      pushEvent("disconnect", "Disconnected from broker");
    });
    socket.on("connect_error", (err: any) => {
      pushEvent("error", `connect error: ${err?.message || err}`);
    });

    socket.on("stats", (s: BrokerStats) => setStats(s));
    socket.on("message", (m: any) =>
      pushEvent("publish", `message queued on "${m?.topic}" (${(m?.id || "").slice(0, 8)})`)
    );
    socket.on("ack", (m: any) =>
      pushEvent("ack", `acked message on "${m?.topic}" (${(m?.id || m?.messageId || "").slice(0, 8)})`)
    );
    socket.on("nack", (m: any) =>
      pushEvent("nack", `nack on "${m?.topic}" attempts=${m?.attempts} (${(m?.id || "").slice(0, 8)})`)
    );
    socket.on("queue-update", () => {
      /* stats event follows; no-op */
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [enabled]);

  return { connected, stats, events };
}
