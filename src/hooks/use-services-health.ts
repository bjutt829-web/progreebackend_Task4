"use client";
import { useEffect, useState } from "react";
import { apiServicesHealth } from "@/lib/api";
import type { ServicesHealth } from "@/lib/eco";

/** Polls /api/services/health on an interval so the header status stays live. */
export function useServicesHealth(enabled: boolean, intervalMs = 5000) {
  const [health, setHealth] = useState<ServicesHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const r = await apiServicesHealth();
      if (!cancelled) {
        setHealth(r.data);
        setLoading(false);
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, intervalMs]);

  return { health, loading };
}
