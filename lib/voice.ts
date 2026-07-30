import { useCallback, useEffect, useRef, useState } from "react";
import { requireOptionalNativeModule } from "expo";
import type { EventSubscription } from "expo-modules-core";
import type {
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
  ExpoSpeechRecognitionErrorEvent,
} from "expo-speech-recognition";
import i18n from "@/lib/i18n";

/**
 * On-device speech recognition ("voice-to-write" and the hands-free voice chat
 * loop), built on expo-speech-recognition.
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
  supportsOnDeviceRecognition?: () => boolean;
  supportsRecording?: () => boolean;
  getSpeechRecognitionServices?: () => string[];
  getDefaultRecognitionService?: () => { packageName: string };
  getSupportedLocales?: (options: {
    androidRecognitionServicePackage?: string;
  }) => Promise<{ locales: string[]; installedLocales: string[] }>;
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  getPermissionsAsync?: () => Promise<{ granted: boolean }>;
  start: (options: ExpoSpeechRecognitionOptions) => void;
  stop: () => void;
  abort?: () => void;
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

export interface VoiceStartOptions {
  /** BCP-47 recognizer locale. Defaults to the app UI language. */
  lang?: string;
  /**
   * Keep recognizing past the first final result. Not supported on Android 12
   * and below; on every platform the session can still end on its own, so a
   * hands-free loop must restart from `onEnd`.
   */
  continuous?: boolean;
  /** Emit partial results as the user speaks. iOS only emits finals after stop. */
  interimResults?: boolean;
  /** Full stops and commas in the transcript (iOS; Android 13+ on-device). */
  addsPunctuation?: boolean;
  /**
   * iOS only: subtract the device's own speaker output from the mic input, so
   * text-to-speech playing aloud isn't transcribed back as user speech. This is
   * what makes barge-in (talking over the AI) usable. May lower playback volume.
   */
  echoCancellation?: boolean;
  /** Mic level, roughly -2..10. Anything below 0 counts as inaudible. */
  onVolume?: (value: number) => void;
  /** The recognizer decided the user stopped talking. */
  onSpeechEnd?: () => void;
  /** The session ended. In a hands-free loop, restart from here. */
  onEnd?: () => void;
  onError?: (code: string, message: string) => void;
}

export interface VoiceDictation {
  /** True only when the native module is linked and recognition is available. */
  supported: boolean;
  /** True between a successful `start` and recognition ending/erroring. */
  listening: boolean;
  /** Latest mic level from `volumechange`, or null when not metering. */
  volume: number | null;
  /** Last recognizer error code, cleared on the next successful start. */
  error: string | null;
  /**
   * Request permission and begin recognition. Resolves `false` if the module is
   * unavailable or permission is denied (the caller should alert). On success,
   * `onText` fires for each partial/final result until `stop()` is called.
   */
  start: (onText: OnTranscript, opts?: VoiceStartOptions) => Promise<boolean>;
  /** Stop recognition (a final result may still arrive). Safe no-op if idle. */
  stop: () => void;
  /** Drop the session without waiting for a final result. */
  abort: () => void;
}

/** Map the app UI language to a BCP-47 recognizer locale. */
export function recognizerLang(): string {
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

export interface VoiceDiagnostics {
  /** False until a native rebuild links expo-speech-recognition. */
  moduleLinked: boolean;
  recognitionAvailable: boolean;
  onDeviceSupported: boolean;
  recordingSupported: boolean;
  /** Android recognition service packages; empty on iOS. */
  services: string[];
  defaultService: string | null;
  permissionGranted: boolean | null;
  /** Locales the recognizer knows; empty on Android 12 and below. */
  locales: string[];
  /** Locales downloaded for offline use. */
  installedLocales: string[];
  error: string | null;
}

/**
 * Probe every capability the recognizer exposes. Used by the Voice Lab dev
 * screen to tell "the native module isn't linked yet" apart from "linked, but
 * this device/locale can't do it" — the two failure modes look identical from
 * the UI otherwise.
 */
export async function voiceDiagnostics(): Promise<VoiceDiagnostics> {
  const base: VoiceDiagnostics = {
    moduleLinked: !!SpeechRecognition,
    recognitionAvailable: false,
    onDeviceSupported: false,
    recordingSupported: false,
    services: [],
    defaultService: null,
    permissionGranted: null,
    locales: [],
    installedLocales: [],
    error: null,
  };
  if (!SpeechRecognition) return base;

  const probe = <T,>(fn: (() => T) | undefined, fallback: T): T => {
    try {
      return fn ? fn() : fallback;
    } catch {
      return fallback;
    }
  };

  base.recognitionAvailable = probe(SpeechRecognition.isRecognitionAvailable, false);
  base.onDeviceSupported = probe(SpeechRecognition.supportsOnDeviceRecognition, false);
  base.recordingSupported = probe(SpeechRecognition.supportsRecording, false);
  base.services = probe(SpeechRecognition.getSpeechRecognitionServices, []);
  base.defaultService = probe(
    SpeechRecognition.getDefaultRecognitionService,
    { packageName: "" },
  ).packageName || null;

  try {
    const perm = await SpeechRecognition.getPermissionsAsync?.();
    base.permissionGranted = perm ? !!perm.granted : null;
  } catch {
    base.permissionGranted = null;
  }

  try {
    const locales = await SpeechRecognition.getSupportedLocales?.({});
    base.locales = locales?.locales ?? [];
    base.installedLocales = locales?.installedLocales ?? [];
  } catch (e: any) {
    // Android 12 and below throw here rather than returning an empty list.
    base.error = e?.message ? String(e.message) : "getSupportedLocales failed";
  }

  return base;
}

export function useVoiceDictation(): VoiceDictation {
  const [supported] = useState(computeSupported);
  const [listening, setListening] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onTextRef = useRef<OnTranscript | null>(null);
  const optsRef = useRef<VoiceStartOptions | null>(null);

  // Subscribe imperatively (only when the native module exists) so the whole
  // hook stays inert — never touching native — when it isn't linked.
  useEffect(() => {
    if (!SpeechRecognition) return;
    let subs: EventSubscription[] = [];
    try {
      subs = [
        SpeechRecognition.addListener("start", () => setListening(true)),
        SpeechRecognition.addListener("end", () => {
          setListening(false);
          setVolume(null);
          optsRef.current?.onEnd?.();
        }),
        SpeechRecognition.addListener("error", (payload) => {
          const e = payload as ExpoSpeechRecognitionErrorEvent;
          setListening(false);
          setVolume(null);
          const code = e?.error ?? "unknown";
          setError(code);
          optsRef.current?.onError?.(code, e?.message ?? "");
        }),
        SpeechRecognition.addListener("speechend", () => {
          optsRef.current?.onSpeechEnd?.();
        }),
        SpeechRecognition.addListener("volumechange", (payload) => {
          const v = (payload as { value?: number })?.value;
          if (typeof v !== "number") return;
          setVolume(v);
          optsRef.current?.onVolume?.(v);
        }),
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
    async (onText: OnTranscript, opts?: VoiceStartOptions): Promise<boolean> => {
      if (!supported || !SpeechRecognition) return false;
      try {
        const perm = await SpeechRecognition.requestPermissionsAsync();
        if (!perm?.granted) {
          setError("not-allowed");
          return false;
        }
        setError(null);
        onTextRef.current = onText;
        optsRef.current = opts ?? null;
        SpeechRecognition.start({
          lang: opts?.lang ?? recognizerLang(),
          interimResults: opts?.interimResults ?? true,
          continuous: opts?.continuous ?? true,
          addsPunctuation: opts?.addsPunctuation ?? true,
          iosVoiceProcessingEnabled: opts?.echoCancellation ?? false,
          volumeChangeEventOptions: opts?.onVolume
            ? { enabled: true, intervalMillis: 100 }
            : undefined,
        });
        setListening(true);
        return true;
      } catch (e: any) {
        onTextRef.current = null;
        optsRef.current = null;
        setListening(false);
        setError(e?.message ? String(e.message) : "start failed");
        return false;
      }
    },
    [supported],
  );

  const stop = useCallback(() => {
    onTextRef.current = null;
    optsRef.current = null;
    setListening(false);
    setVolume(null);
    if (!SpeechRecognition) return;
    try {
      SpeechRecognition.stop();
    } catch {
      // ignore
    }
  }, []);

  const abort = useCallback(() => {
    onTextRef.current = null;
    optsRef.current = null;
    setListening(false);
    setVolume(null);
    if (!SpeechRecognition) return;
    try {
      SpeechRecognition.abort?.();
    } catch {
      // ignore
    }
  }, []);

  return { supported, listening, volume, error, start, stop, abort };
}
