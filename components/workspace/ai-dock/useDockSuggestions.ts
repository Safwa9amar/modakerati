import { useEffect, useState } from "react";
import { useNotificationStore } from "@/stores/notification-store";
import { getComposerSuggestions, type ComposerSuggestion } from "@/lib/api";

/**
 * Scope-grounded suggestion chips. Intentionally separate from
 * hooks/useComposerSuggestions (no debounce, no cache — the dock unmounts on
 * collapse) but honours the same `preferences.aiSuggestions` gate.
 *
 * No threadId is sent, on purpose: the dock has no conversation of its own, and
 * the server falls back to the thesis's newest non-archived thread — the same one
 * ensureThreadFor picks, so the chips ground on exactly the conversation a send
 * from here would join. Resolving it in the app instead would mean CREATING a
 * thread from a passive fetch that fires on every selection change.
 */
export function useDockSuggestions(thesisId: string, indices: number[]) {
  // Subscribed, not read once, so toggling the setting clears/restores chips live.
  const enabled = useNotificationStore((s) => s.preferences.aiSuggestions);
  const [suggestions, setSuggestions] = useState<ComposerSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  // The primitive identity of `indices` — an array literal would re-fire every render.
  const scopeKey = indices.join(",");

  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const list = scopeKey ? scopeKey.split(",").map(Number) : [];
    getComposerSuggestions(
      thesisId,
      {
        docBlockIndex: list.length ? list[0] : null,
        docBlockIndices: list.length > 1 ? list : undefined,
      },
      controller.signal,
    )
      .then((result) => {
        if (!cancelled) setSuggestions(result);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [thesisId, scopeKey, enabled]);

  return { suggestions, loading: loading && enabled, enabled };
}
