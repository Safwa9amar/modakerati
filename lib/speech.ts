import * as Speech from "expo-speech";
import { setAudioModeAsync, createAudioPlayer, type AudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { ttsAudioSource } from "./api";

/**
 * Text-to-speech for the voice chat loop.
 *
 * Two things make this more than a thin wrapper over `Speech.speak`:
 *
 * 1. **Silent mode.** On iOS, expo-speech produces NO sound while the ringer
 *    switch is silenced — the reply looks like it played and the user hears
 *    nothing. `initSpeechAudio()` sets an audio mode that plays anyway, and must
 *    run before the first `speak`.
 * 2. **Streaming.** The chat endpoint streams token deltas. Waiting for the full
 *    reply before speaking adds seconds of dead air, so `SpeechQueue` buffers
 *    deltas and hands each COMPLETE SENTENCE to the synthesizer as it lands.
 *    expo-speech queues utterances natively, so playback stays gapless.
 *
 * Deltas arrive as markdown (the chat renders it), so everything is stripped to
 * plain prose first — otherwise the synthesizer reads asterisks and pipes aloud.
 */

const TERMINATORS = ".!?…؟۔";

/**
 * Index just past the next sentence terminator, or -1 if there isn't one.
 *
 * Hand-written rather than a regex because the one case that matters most —
 * "don't break on a period that belongs to a number" — needs to look at the
 * character BEFORE the dot, and lookbehind isn't dependable on Hermes.
 *
 * A dot preceded by a digit is a list marker ("1.") or a decimal ("4.2"), never
 * the end of a sentence. Breaking there made the voice read "one. point." and
 * split section numbers in half.
 */
function findSentenceEnd(s: string): number {
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\n") return i + 1;
    if (!TERMINATORS.includes(c)) continue;
    const next = s[i + 1];
    // Mid-word punctuation ("4.2", "google.com") isn't a boundary.
    if (next !== undefined && !/\s/.test(next)) continue;
    if (c === "." && i > 0 && /[0-9]/.test(s[i - 1])) continue;
    return i + 1;
  }
  return -1;
}

/**
 * Whether `s` can be spoken without leaving a dangling emphasis marker.
 *
 * Deltas arrive mid-token, so a chunk can end inside `**bold**`. Its partner
 * lands in the NEXT chunk, so the paired rules in `stripForSpeech` can't match
 * and the marker survives. Holding the cut until the markers balance keeps
 * emphasized phrases intact instead of split across two utterances.
 */
function emphasisBalanced(s: string): boolean {
  const doubles = (s.match(/\*\*/g) || []).length;
  const ticks = (s.match(/`/g) || []).length;
  return doubles % 2 === 0 && ticks % 2 === 0;
}
/** Speak a chunk anyway once it gets this long with no terminator in sight. */
const MAX_CHUNK = 220;
/**
 * How long the neural voice gets to START playing before we give up on it.
 *
 * Must exceed the server's own TTS_TIMEOUT_MS (20s) or the client gives up while
 * the server is still working, and we'd fall back to the OS voice on sentences
 * that were about to succeed. Sized for the slowest provider: Gemini takes ~5s
 * for a short Arabic sentence and proportionally longer for a full-length one,
 * versus roughly 1-2s for the local Piper sidecar.
 */
const NEURAL_START_TIMEOUT_MS = 25_000;
/** Backstop so a wedged player can't stall the conversation indefinitely. */
const PLAYBACK_WATCHDOG_MS = 120_000;

let audioModeReady = false;

/**
 * Allow speech through the iOS silent switch. Safe to call repeatedly; only the
 * first call touches native. Ducks other audio rather than stopping it, so a
 * podcast or music resumes after the AI finishes talking.
 */
export async function initSpeechAudio(): Promise<void> {
  if (audioModeReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "duckOthers",
    });
    audioModeReady = true;
  } catch {
    // Non-fatal: TTS still works, just not through the silent switch.
  }
}

/**
 * Reduce markdown to what should actually be read aloud. Tables and fenced code
 * are dropped entirely rather than spelled out — a synthesizer reading pipe
 * characters is worse than silence.
 */
export function stripForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")           // fenced code
    .replace(/^\s*\|.*\|\s*$/gm, " ")          // table rows
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")   // links → their text
    .replace(/`([^`]+)`/g, "$1")               // inline code
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")        // headings
    .replace(/^\s{0,3}>\s?/gm, "")             // blockquotes
    .replace(/^\s{0,3}([-*_])\s*\1\s*\1[\s*_-]*$/gm, " ") // horizontal rules
    .replace(/^\s{0,3}[-*+]\s+/gm, "")         // bullets
    // Numbered list markers ("1. ", "2) "). Without this the synthesizer reads
    // the number AND the dot as their own utterance — "one. point."
    .replace(/^\s{0,3}\d+[.)]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")         // bold
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")             // italic
    .replace(/~~([^~]+)~~/g, "$1")             // strikethrough
    // Arrows and pipes carry meaning on screen but are noise aloud.
    .replace(/[→←↔⇒⇐➔·•|]+/g, " ")
    // SAFETY NET: any emphasis marker still standing here straddled a streaming
    // chunk boundary, so its partner never arrived and the paired rules above
    // couldn't match it. Without this sweep the voice literally says "asterisk".
    .replace(/[*_~`]+/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SpeechQueueOptions {
  /** BCP-47 voice language, e.g. "ar-SA". */
  language?: string;
  /** Explicit voice identifier from `Speech.getAvailableVoicesAsync()`. */
  voice?: string;
  rate?: number;
  pitch?: number;
  /**
   * Use the server's neural voice (Piper) instead of the phone's built-in
   * synthesizer. Falls back to the OS voice automatically and permanently for
   * the rest of the turn if the endpoint fails — a robotic voice beats silence.
   */
  neural?: boolean;
  /** Which server voice to use ("piper" | "gemini"). Omit for the server's default. */
  provider?: string;
  /** Fires when the queue drains after `flush()` — the AI has finished talking. */
  onIdle?: () => void;
  /** Fires with each chunk actually sent to the synthesizer (for debugging). */
  onChunk?: (text: string) => void;
  /** Fires once if the neural voice fails and playback drops to the OS voice. */
  onFallback?: (reason: string) => void;
}

/**
 * Buffers streamed text and speaks it sentence by sentence.
 *
 * Usage: `push()` each delta, `flush()` when the stream ends, `stop()` to cut
 * the AI off mid-word (barge-in). Once stopped, a queue accepts no further
 * input — build a new one for the next turn.
 */
export class SpeechQueue {
  private buffer = "";
  private pending = 0;
  private flushed = false;
  private stopped = false;
  private opts: SpeechQueueOptions;
  // Neural path only. expo-speech queues utterances natively, but audio players
  // don't — so sentences are played one at a time through this queue, or they'd
  // all start at once and talk over each other.
  private clips: string[] = [];
  private running = false;
  private player: AudioPlayer | null = null;
  private fellBack = false;

  constructor(opts: SpeechQueueOptions = {}) {
    this.opts = opts;
  }

  /** Feed one streamed delta. Complete sentences are spoken immediately. */
  push(delta: string): void {
    if (this.stopped || !delta) return;
    this.buffer += delta;
    this.drain(false);
  }

  /** Stream is done: speak whatever is left, even without a terminator. */
  flush(): void {
    if (this.stopped) return;
    this.flushed = true;
    this.drain(true);
    // Nothing was ever queued (empty or markdown-only reply) — report idle now,
    // otherwise no onDone will ever arrive to do it.
    if (this.pending === 0) this.opts.onIdle?.();
  }

  /** Cut playback immediately. The queue is dead after this. */
  stop(): void {
    this.stopped = true;
    this.buffer = "";
    this.pending = 0;
    this.clips = [];
    try {
      this.player?.pause();
      this.player?.remove();
    } catch {
      // Player already released.
    }
    this.player = null;
    void Speech.stop();
  }

  get isSpeaking(): boolean {
    return this.pending > 0;
  }

  private drain(final: boolean): void {
    for (;;) {
      const chunk = this.takeChunk(final);
      if (!chunk) return;
      this.speak(chunk);
    }
  }

  /**
   * Pull the next speakable chunk out of the buffer, or null if we should wait
   * for more text. Cuts at a sentence terminator; failing that, at the last word
   * boundary once the buffer grows past MAX_CHUNK so long unpunctuated replies
   * still start playing.
   */
  private takeChunk(final: boolean): string | null {
    if (!this.buffer.trim()) {
      this.buffer = final ? "" : this.buffer;
      return null;
    }
    const end = findSentenceEnd(this.buffer);
    if (end >= 0) {
      const candidate = this.buffer.slice(0, end);
      // Wait for the closing marker unless the stream is over, so bold phrases
      // aren't cut in half. `final` overrides — the partner is never coming.
      if (final || emphasisBalanced(candidate)) {
        this.buffer = this.buffer.slice(end);
        return candidate.trim() || this.takeChunk(final);
      }
    }
    if (this.buffer.length >= MAX_CHUNK) {
      const space = this.buffer.lastIndexOf(" ", MAX_CHUNK);
      const cut = space > 40 ? space : MAX_CHUNK;
      const chunk = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      return chunk.trim() || null;
    }
    if (final) {
      const chunk = this.buffer;
      this.buffer = "";
      return chunk.trim() || null;
    }
    return null;
  }

  private speak(raw: string): void {
    const text = stripForSpeech(raw);
    if (!text) return;
    this.pending += 1;
    this.opts.onChunk?.(text);
    if (this.opts.neural && !this.fellBack) {
      this.clips.push(text);
      void this.runClips();
    } else {
      this.speakOnDevice(text);
    }
  }

  /** One utterance finished (either path). Reports idle when the turn is over. */
  private finishOne(): void {
    this.pending = Math.max(0, this.pending - 1);
    if (this.pending === 0 && this.flushed && !this.stopped) this.opts.onIdle?.();
  }

  /** The phone's built-in synthesizer — robotic, but always available. */
  private speakOnDevice(text: string): void {
    const done = () => this.finishOne();
    try {
      Speech.speak(text, {
        language: this.opts.language,
        voice: this.opts.voice,
        rate: this.opts.rate,
        pitch: this.opts.pitch,
        onDone: done,
        onStopped: done,
        onError: done,
      });
    } catch {
      done();
    }
  }

  /** Play queued neural clips strictly in order, one at a time. */
  private async runClips(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.clips.length && !this.stopped) {
        const text = this.clips.shift()!;
        try {
          await this.playNeural(text);
        } catch (err: any) {
          // The server voice failed. Don't retry it sentence after sentence —
          // drop to the OS voice for the REST of this turn, starting with the
          // sentence that failed, so the reply still finishes out loud.
          this.fellBack = true;
          this.opts.onFallback?.(err?.message ? String(err.message) : "tts unavailable");
          this.speakOnDevice(text);
          for (const rest of this.clips.splice(0)) this.speakOnDevice(rest);
          return; // those sentences own their own finishOne() now
        }
        this.finishOne();
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Fetch one sentence from the server's neural voice and play it. Resolves when
   * playback ends; rejects with a real reason so the caller can fall back.
   *
   * Downloads to a cache file first rather than handing the URL straight to the
   * player. Two reasons, both learned the hard way:
   *
   *  - `AudioStatus` has no error field, so a failed load is INVISIBLE to the
   *    player. A 503 would simply never fire an event, and playback would hang
   *    until the timeout — indistinguishable from "the neural voice never works".
   *    `downloadFileAsync` rejects with the HTTP status instead, so the Events
   *    log names the actual cause.
   *  - A local `.wav` removes any container-sniffing ambiguity on Android.
   */
  private async playNeural(text: string): Promise<void> {
    const source = await ttsAudioSource(
      text,
      this.opts.language || "en",
      this.opts.rate,
      this.opts.provider,
    );

    const dest = new File(Paths.cache, `tts-${clipSeq++}.wav`);
    let file: File;
    try {
      file = await withTimeout(
        File.downloadFileAsync(source.uri, dest, { headers: source.headers, idempotent: true }),
        NEURAL_START_TIMEOUT_MS,
        "tts download timeout",
      );
    } catch (e: any) {
      // Message carries the HTTP status for a non-OK response.
      throw new Error(e?.message ? String(e.message) : "tts download failed");
    }

    if (this.stopped) {
      safeDelete(file);
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let player: AudioPlayer | null = null;
        let sub: { remove: () => void } | null = null;

        const cleanup = () => {
          try {
            sub?.remove();
          } catch {
            // listener already gone
          }
          try {
            player?.remove();
          } catch {
            // player already released
          }
          if (this.player === player) this.player = null;
        };
        const done = (err?: string) => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          cleanup();
          err ? reject(new Error(err)) : resolve();
        };

        // Playback of a local file can't legitimately outlast this; the guard
        // only exists so a stuck player can't wedge the conversation forever.
        const watchdog = setTimeout(() => done("tts playback stalled"), PLAYBACK_WATCHDOG_MS);

        try {
          player = createAudioPlayer({ uri: file.uri });
          this.player = player;
          sub = player.addListener("playbackStatusUpdate", (status) => {
            if (status.didJustFinish) done();
          });
          player.play();
        } catch (e: any) {
          done(e?.message ? String(e.message) : "audio player failed");
        }
      });
    } finally {
      safeDelete(file);
    }
  }
}

/** Unique cache filenames so concurrent turns can't collide. */
let clipSeq = 0;

function safeDelete(file: File): void {
  try {
    file.delete();
  } catch {
    // Already gone, or the OS cleared the cache — nothing to do.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(reason)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** One-shot speak, for the TTS bench in the Voice Lab. */
export async function speakOnce(
  text: string,
  opts: { language?: string; voice?: string; rate?: number; pitch?: number; onDone?: () => void } = {},
): Promise<void> {
  await initSpeechAudio();
  const clean = stripForSpeech(text);
  if (!clean) return;
  Speech.speak(clean, {
    language: opts.language,
    voice: opts.voice,
    rate: opts.rate,
    pitch: opts.pitch,
    onDone: opts.onDone,
    onStopped: opts.onDone,
    onError: opts.onDone,
  });
}

export function stopSpeaking(): void {
  void Speech.stop();
}

/** Voices installed on this device, for the language picker. */
export async function listVoices(): Promise<Speech.Voice[]> {
  try {
    return await Speech.getAvailableVoicesAsync();
  } catch {
    return [];
  }
}
