import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechQueue, initSpeechAudio } from "@/lib/speech";
import { ttsCapabilities } from "@/lib/api";
import { getTextDirection } from "@/lib/text-direction";

/**
 * Read ONE chat message out loud, on demand.
 *
 * The voice-chat loop (`SpeechQueue`) speaks a reply as it streams; this is the
 * other half of the same machinery — a finished message the reader taps to hear.
 * Reusing the queue rather than `Speech.speak` buys three things that matter as
 * much here as they do in the loop: the neural server voice with an automatic
 * drop to the OS voice when it fails, sentence-at-a-time playback so a long
 * answer starts talking in about a second instead of after the whole thing is
 * synthesized, and a `stop()` that actually cuts the audio mid-word.
 *
 * Only one message speaks at a time — starting another (or leaving the chat)
 * stops the current one, so the state lives here, above the bubbles.
 */

/**
 * Which neural voice the server can offer, or null for the phone's own.
 *
 * Resolved once per app session and shared by every chat instance: the answer
 * can't change without a server deploy, and a health round-trip on every tap
 * would delay the sound the user just asked for.
 */
let providerPromise: Promise<string | null> | null = null;

function resolveProvider(): Promise<string | null> {
  if (!providerPromise) {
    providerPromise = ttsCapabilities()
      .then((c) => (c.enabled && c.providers.length ? c.default || c.providers[0] : null))
      .catch(() => null);
  }
  return providerPromise;
}

/**
 * Voice locale for a message.
 *
 * Arabic is detectable from the text itself, so an Arabic answer is read by an
 * Arabic voice even in the English UI. English and French share a script and
 * aren't worth guessing at from content, so those fall back to the UI locale.
 */
function speechLang(text: string, uiLocale: string): string {
  if (getTextDirection(text) === "rtl") return "ar-SA";
  return uiLocale.startsWith("fr") ? "fr-FR" : "en-US";
}

export function useSpeakMessage(uiLocale: string) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const speakingIdRef = useRef<string | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);
  // Bumped whenever playback starts or stops. A tap has to await the capability
  // lookup and the audio-mode setup before it can build a queue; if the user
  // taps something else in the meantime, the stale continuation compares this
  // and bails instead of speaking over the new selection.
  const turnRef = useRef(0);

  const setSpeaking = (id: string | null) => {
    speakingIdRef.current = id;
    setSpeakingId(id);
  };

  const stop = useCallback(() => {
    turnRef.current += 1;
    queueRef.current?.stop();
    queueRef.current = null;
    setSpeaking(null);
  }, []);

  // Closing the chat must not leave a voice reading to an empty screen.
  useEffect(() => stop, [stop]);

  /** Tap to hear `text`; tap the same message again to cut it off. */
  const toggle = useCallback(
    async (id: string, text: string) => {
      const wasThisOne = speakingIdRef.current === id;
      stop();
      if (wasThisOne) return;

      const body = text.trim();
      if (!body) return;
      const turn = turnRef.current;
      setSpeaking(id);

      const [provider] = await Promise.all([resolveProvider(), initSpeechAudio()]);
      if (turn !== turnRef.current) return; // superseded while awaiting

      const queue = new SpeechQueue({
        language: speechLang(body, uiLocale),
        neural: !!provider,
        provider: provider ?? undefined,
        onIdle: () => {
          if (turn === turnRef.current) setSpeaking(null);
        },
      });
      queueRef.current = queue;
      queue.push(body);
      queue.flush();
    },
    [stop, uiLocale],
  );

  return { speakingId, toggle, stop };
}
