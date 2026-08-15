import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { secureStoreAdapter } from "@/lib/storage";

/**
 * BYOK — the student's own AI provider key.
 *
 * This is what makes the free tier free: with a key set, every AI request the
 * app makes carries it, the server runs the models on it, and the inference is
 * billed to the student's provider account instead of ours. Clear the key and
 * the app goes back to the platform's AI (the paid tiers).
 *
 * The key lives in the OS keychain (expo-secure-store) rather than AsyncStorage
 * — it is a spendable credential, not a preference. It is sent to our server on
 * each request because the whole agentic pipeline (tool loop, RAG, .docx tools)
 * runs there; the server holds it for the request and never stores it.
 */

/** Providers a student can realistically hold a personal key for. */
export type ByokProvider = "openrouter";

/** Mirrors the server's `byok_*` error codes (lib/ai/byok.ts). */
export type ByokErrorCode =
  | "byok_key_rejected"
  | "byok_insufficient_credit"
  | "byok_rate_limited"
  | "byok_model_denied"
  | "byok_key_invalid"
  | "byok_key_missing"
  | "byok_provider_unsupported"
  | "byok_model_invalid";

const BYOK_ERROR_CODES: readonly string[] = [
  "byok_key_rejected",
  "byok_insufficient_credit",
  "byok_rate_limited",
  "byok_model_denied",
  "byok_key_invalid",
  "byok_key_missing",
  "byok_provider_unsupported",
  "byok_model_invalid",
];

export function isByokErrorCode(v: unknown): v is ByokErrorCode {
  return typeof v === "string" && BYOK_ERROR_CODES.includes(v);
}

interface ByokState {
  /** Off by default — an account with no key uses the platform's AI. */
  enabled: boolean;
  provider: ByokProvider;
  /** The raw key. Never leaves the device except as a request header. */
  apiKey: string;
  /** "" = let the server pick its cheap default. */
  model: string;
  /** Last failure the provider reported for this key, for the settings screen. */
  lastError: ByokErrorCode | null;

  setKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setEnabled: (enabled: boolean) => void;
  clearKey: () => void;
  setLastError: (code: ByokErrorCode | null) => void;
}

export const useByokStore = create<ByokState>()(
  persist(
    (set) => ({
      enabled: false,
      provider: "openrouter",
      apiKey: "",
      model: "",
      lastError: null,

      // Saving a key turns BYOK on: a student who just pasted a key means to use
      // it, and a saved-but-inactive key reads as a bug. Clearing the error too,
      // so a re-paste after a rejection doesn't keep showing the old failure.
      setKey: (apiKey) => {
        const trimmed = apiKey.trim();
        set({ apiKey: trimmed, enabled: trimmed.length > 0, lastError: null });
      },
      setModel: (model) => set({ model: model.trim(), lastError: null }),
      setEnabled: (enabled) => set({ enabled }),
      clearKey: () => set({ apiKey: "", enabled: false, lastError: null }),
      setLastError: (lastError) => set({ lastError }),
    }),
    {
      name: "kwill-byok",
      storage: createJSONStorage(() => secureStoreAdapter),
      version: 1,
    },
  ),
);

/** True when requests should carry the student's key. */
export function byokIsActive(): boolean {
  const { enabled, apiKey } = useByokStore.getState();
  return enabled && apiKey.length > 0;
}

/**
 * The headers that put a request on the student's own key.
 *
 * Empty when BYOK is off, which is exactly how the server reads "use platform
 * keys" — absent headers are the normal case there, not an error.
 */
export function byokHeaders(): Record<string, string> {
  const { enabled, apiKey, provider, model } = useByokStore.getState();
  if (!enabled || !apiKey) return {};
  return {
    "x-byok-key": apiKey,
    "x-byok-provider": provider,
    ...(model ? { "x-byok-model": model } : {}),
  };
}

/**
 * Resolves once the key has been read back out of the keychain.
 *
 * Hydration from SecureStore is async, so a request fired during app start
 * would otherwise go out with no BYOK header and quietly run on OUR keys —
 * the student would be told they're paying their own way while we pick up the
 * bill. Every request awaits this first.
 */
export function whenByokHydrated(): Promise<void> {
  if (useByokStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useByokStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
  });
}
