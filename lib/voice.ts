import { useCallback, useEffect, useRef, useState } from "react";
import { requireOptionalNativeModule } from "expo";
import type { EventSubscription } from "expo-modules-core";
import type {
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import i18n from "@/lib/i18n";

/**
 * On-device voice dictation ("voice-to-write") built on expo-speech-recognition.
 *
 * The package's own entry point resolves the native module via
 * `requireNativeModule`, which THROWS synchronously when the native side isn't
 * linked yet (i.e. before `npx expo run:android|ios` rebuilds the dev client).
 * To keep dictation a safe no-op until then, we resolve the module ourselves
 * with `requireOptionalNativeModule` (returns null instead of throwing) and
 * subscribe to its events imperatively — never importing the throwing entry.
 * `supported` is false until a native rebuild ships the module, so callers fall
 * back to their existing "coming soon" behavior.
 */
type SpeechRecognitionNativeModule = {
  isRecognitionAvailable?: () => boolean;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: ExpoSpeechRecognitionOptions) => void;
  stop: () => void;
  addListener: (
    eventName: string,
    listener: (payload: unknown) => void,
  ) => EventSubscription;
};

const SpeechRecognition = requireOptionalNativeModule<SpeechRecognitionNativeModule>(
  "ExpoSpeechRecognition",
);

/** Called on every (partial or final) transcript while dictation is active. */
export type OnTranscript = (transcript: string, isFinal: boolean) => void;

export interface VoiceDictation {
  /** True only when the native module is linked and recognition is available. */
  supported: boolean;
  /** True between a successful `start` and recognition ending/erroring. */
  listening: boolean;
  /**
   * Request permission and begin recognition. Resolves `false` if the module is
   * unavailable or permission is denied (the caller should alert). On success,
   * `onText` fires for each partial/final result until `stop()` is called.
   */
  start: (onText: OnTranscript) => Promise<boolean>;
  /** Stop recognition (a final result may still arrive). Safe no-op if idle. */
  stop: () => void;
}

/** Map the app UI language to a BCP-47 recognizer locale. */
function recognizerLang(): string {
  const lang = (i18n.language || "").slice(0, 2).toLowerCase();
  if (lang === "ar") return "ar-SA";
  if (lang === "fr") return "fr-FR";
  return "en-US";
}

/** Whether recognition is available — guarded so it never throws. */
function computeSupported(): boolean {
  try {
    if (!SpeechRecognition) return false;
    if (typeof SpeechRecognition.isRecognitionAvailable === "function") {
      return !!SpeechRecognition.isRecognitionAvailable();
    }
    // Module linked but the availability probe is missing — assume usable.
    return true;
  } catch {
    return false;
  }
}

export function useVoiceDictation(): VoiceDictation {
  const [supported] = useState(computeSupported);
  const [listening, setListening] = useState(false);
  const onTextRef = useRef<OnTranscript | null>(null);

  // Subscribe imperatively (only when the native module exists) so the whole
  // hook stays inert — never touching native — when it isn't linked.
  useEffect(() => {
    if (!SpeechRecognition) return;
    let subs: EventSubscription[] = [];
    try {
      subs = [
        SpeechRecognition.addListener("start", () => setListening(true)),
        SpeechRecognition.addListener("end", () => setListening(false)),
        SpeechRecognition.addListener("error", () => setListening(false)),
        SpeechRecognition.addListener("result", (payload) => {
          const e = payload as ExpoSpeechRecognitionResultEvent;
          const transcript = e?.results?.[0]?.transcript ?? "";
          if (transcript) onTextRef.current?.(transcript, !!e.isFinal);
        }),
      ];
    } catch {
      subs = [];
    }
    return () => {
      for (const s of subs) {
        try {
          s.remove();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const start = useCallback(
    async (onText: OnTranscript): Promise<boolean> => {
      if (!supported || !SpeechRecognition) return false;
      try {
        const perm = await SpeechRecognition.requestPermissionsAsync();
        if (!perm?.granted) return false;
        onTextRef.current = onText;
        SpeechRecognition.start({
          lang: recognizerLang(),
          interimResults: true,
          continuous: true,
        });
        setListening(true);
        return true;
      } catch {
        onTextRef.current = null;
        setListening(false);
        return false;
      }
    },
    [supported],
  );

  const stop = useCallback(() => {
    onTextRef.current = null;
    setListening(false);
    if (!SpeechRecognition) return;
    try {
      SpeechRecognition.stop();
    } catch {
      // ignore
    }
  }, []);

  return { supported, listening, start, stop };
}
