import { useEffect, useRef, useState } from "react";
import { useChatStore } from "@/stores/chat-store";
import { getComposerSuggestions, type ComposerSuggestion } from "@/lib/api";

// Wait for rapid changes (tapping through blocks) to settle before hitting the
// server, so a burst of selections yields a single request.
const DEBOUNCE_MS = 600;

interface Options {
  /** Only fetch while the chips are actually visible (composer open, AI mode, …). */
  enabled: boolean;
  /** Workspace selection to ground on. Omit in plain chat (no block selection). */
  selectedBlocks?: { index: number; text: string }[];
}

/**
 * Dynamic quick-action chips. Fetches AI-generated suggestions grounded in the
 * recent conversation + the current selection + RAG, and refreshes them:
 *   - after an AI turn finishes (isGenerating true → false appends a new message),
 *   - when the selected block(s) change,
 *   - when the caller becomes enabled (composer/chat opens).
 *
 * Debounced and cached by (last message id + selection) so unchanged context never
 * refetches. Returns `[]` until the first fetch resolves and on any failure — the
 * caller falls back to its static presets whenever the list is empty. Store-agnostic
 * so both the workspace composer and the chat screen can use it.
 */
export function useComposerSuggestions(thesisId: string, { enabled, selectedBlocks }: Options) {
  const isGenerating = useChatStore((s) => s.isGenerating);
  // Subscribe to the last message id so the effect re-runs when history first
  // loads and after each new turn — driving the "refresh after a reply" trigger.
  const lastMessageId = useChatStore((s) => {
    const m = s.messages[thesisId];
    return m && m.length ? m[m.length - 1].id : "";
  });

  const [suggestions, setSuggestions] = useState<ComposerSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  // Context signature of the last fetch, so identical context doesn't refetch.
  const lastKeyRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Primitive dep for the selection so the effect only re-runs on a real change.
  const selectionKey = (selectedBlocks ?? []).map((b) => b.index).join(",");

  useEffect(() => {
    // Only while visible, and NOT mid-generation (wait for the turn to finish so
    // its reply feeds the chips).
    if (!enabled || !thesisId || isGenerating) return;

    // Nothing to ground on (brand-new thesis, no selection) → show static presets.
    if (!lastMessageId && !selectionKey) {
      setSuggestions([]);
      return;
    }

    const key = `${lastMessageId}|${selectionKey}`;
    if (key === lastKeyRef.current) return; // context unchanged since last fetch

    // Per-run flag: the cleanup flips it so a response that resolves after the
    // context changed (or after unmount) can't overwrite fresher chips.
    let cancelled = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      lastKeyRef.current = key;
      setLoading(true);
      try {
        const blocks = selectedBlocks ?? [];
        const combined = blocks.map((b) => b.text).filter(Boolean).join("\n\n");
        const indices = blocks.map((b) => b.index);
        const result = await getComposerSuggestions(thesisId, {
          selection: combined || undefined,
          docBlockIndex: indices.length ? indices[0] : null,
          docBlockIndices: indices.length > 1 ? indices : undefined,
        });
        if (!cancelled) setSuggestions(result);
      } catch {
        // Leave the previous chips in place; the caller shows presets when empty.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thesisId, enabled, isGenerating, selectionKey, lastMessageId]);

  return { suggestions, loading };
}
