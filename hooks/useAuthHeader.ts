import { useEffect, useState } from "react";
import { getAuthHeader } from "@/lib/api";

// Resolved Bearer header, shared across every figure so they don't each call
// getSession(). Only cached once a real token is present (so a mount during an
// unsettled session can still retry later).
let cached: Record<string, string> | null = null;
let inflight: Promise<Record<string, string>> | null = null;

function resolveHeader(): Promise<Record<string, string>> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = getAuthHeader().then((h) => {
      inflight = null;
      if (h.Authorization) cached = h;
      return h;
    });
  }
  return inflight;
}

/**
 * Resolves the Bearer Authorization header for authed native <Image> loads (which
 * can't go through the fetch-based api client). Returns null until it resolves.
 */
export function useAuthHeader(): Record<string, string> | null {
  const [header, setHeader] = useState<Record<string, string> | null>(cached);
  useEffect(() => {
    if (header) return;
    let alive = true;
    void resolveHeader().then((h) => {
      if (alive) setHeader(h);
    });
    return () => {
      alive = false;
    };
  }, [header]);
  return header;
}
