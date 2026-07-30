import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Mic, Square, Volume2, MessageSquare, Trash2 } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { BackButton } from "@/components/BackButton";
import { useVoiceDictation, voiceDiagnostics, type VoiceDiagnostics } from "@/lib/voice";
import {
  SpeechQueue,
  initSpeechAudio,
  speakOnce,
  stopSpeaking,
  listVoices,
} from "@/lib/speech";
import { listTheses, chatSendStream, ttsCapabilities, type TtsCapabilities } from "@/lib/api";
import type { Thesis } from "@/types/thesis";

/**
 * Voice Lab — dev-only bench for the voice chat loop.
 *
 * Three benches, in the order you should trust them:
 *
 * 1. **Diagnostics** — is the native module even linked? Everything below is a
 *    silent no-op until `npx expo run:ios|android` rebuilds the dev client,
 *    because `lib/voice.ts` resolves the module optionally so Expo Go can't
 *    crash. This card is how you tell "not linked" from "linked but refused".
 * 2. **Recognition / synthesis** — each half in isolation, so a broken loop can
 *    be blamed on the right one.
 * 3. **Conversation** — the real hands-free loop against `/api/chat/stream`,
 *    including the agentic tool pipeline. Turns are persisted server-side, so
 *    whatever you say here also lands in that thesis's chat history.
 */

type Phase = "idle" | "listening" | "thinking" | "speaking";
type DeviceVoice = Awaited<ReturnType<typeof listVoices>>[number];

/**
 * Pick the installed voice for a locale. Exact match first, then any voice for
 * the same language — "ar-SA" is happily read by an "ar" voice. Returns null
 * when the language isn't installed at all, which is the case worth warning
 * about: iOS synthesizes NOTHING and gives no error.
 */
function voiceFor(voices: DeviceVoice[] | null, lang: string): DeviceVoice | null {
  if (!voices) return null;
  const want = lang.toLowerCase();
  const exact = voices.find((v) => v.language.toLowerCase() === want);
  if (exact) return exact;
  const prefix = want.slice(0, 2);
  return voices.find((v) => v.language.toLowerCase().startsWith(prefix)) ?? null;
}

const LANGS = [
  { code: "en-US", label: "English" },
  { code: "fr-FR", label: "Français" },
  { code: "ar-SA", label: "العربية" },
];

/** Display names for voice modes; unknown providers fall back to their raw name. */
const VOICE_LABELS: Record<string, string> = {
  piper: "Piper (local)",
  gemini: "Gemini",
  device: "Device",
};

const SAMPLE_TEXT: Record<string, string> = {
  "en-US": "This is the thesis assistant. I can draft, rewrite, and format your chapters.",
  "fr-FR": "Ceci est l'assistant de thèse. Je peux rédiger et reformuler vos chapitres.",
  "ar-SA": "هذا هو مساعد الأطروحة. يمكنني صياغة فصولك وإعادة صياغتها.",
};

/** Silence after the last recognized word before the turn is sent. */
const SILENCE_MS = 1200;
const LOG_CAP = 14;

export default function VoiceLabScreen() {
  const colors = useThemeColors();
  const voice = useVoiceDictation();

  const [lang, setLang] = useState("en-US");
  const [diag, setDiag] = useState<VoiceDiagnostics | null>(null);
  const [voices, setVoices] = useState<DeviceVoice[] | null>(null);
  // "device" = the phone's built-in voice; anything else is a server provider
  // name ("piper" | "gemini"). Kept as a string so a provider added server-side
  // shows up here without an app release.
  const [voiceMode, setVoiceMode] = useState("device");
  const [caps, setCaps] = useState<TtsCapabilities | null>(null);
  const neural = voiceMode !== "device";
  const [log, setLog] = useState<string[]>([]);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, LOG_CAP));
  }, []);

  useEffect(() => {
    void initSpeechAudio();
    void voiceDiagnostics().then(setDiag);
    void listVoices().then(setVoices);
    void ttsCapabilities().then((c) => {
      setCaps(c);
      // Start on the server's preferred voice when there is one.
      if (c.enabled && c.providers.length) setVoiceMode(c.default || c.providers[0]);
    });
  }, []);

  // ─── Bench 2a: recognition ────────────────────────────────────────────────
  const [partial, setPartial] = useState("");
  const [finals, setFinals] = useState<string[]>([]);
  const [sttOn, setSttOn] = useState(false);

  const toggleStt = useCallback(async () => {
    if (sttOn) {
      voice.stop();
      setSttOn(false);
      addLog("stt: stopped");
      return;
    }
    setPartial("");
    const ok = await voice.start(
      (text, isFinal) => {
        setPartial(text);
        if (isFinal) setFinals((prev) => [text, ...prev].slice(0, 8));
      },
      {
        lang,
        onVolume: () => {},
        onEnd: () => addLog("stt: session ended"),
        onError: (code, msg) => addLog(`stt error: ${code} ${msg}`),
      },
    );
    setSttOn(ok);
    addLog(ok ? `stt: listening (${lang})` : "stt: start refused");
    // The first start is what triggers the permission prompt, so the card above
    // is stale until we re-probe.
    void voiceDiagnostics().then(setDiag);
  }, [sttOn, voice, lang, addLog]);

  // ─── Bench 2b: synthesis ──────────────────────────────────────────────────
  const [ttsText, setTtsText] = useState(SAMPLE_TEXT["en-US"]);
  const [rate, setRate] = useState(1.0);
  const previewRef = useRef<SpeechQueue | null>(null);
  // Resolved once here — both the synthesis bench and the conversation loop use it.
  const langVoice = voiceFor(voices, lang);

  /**
   * Speak the sample through the SAME queue the conversation uses, so the
   * preview is a true A/B of the two voices — including the neural fallback.
   */
  const previewVoice = useCallback(async () => {
    previewRef.current?.stop();
    await initSpeechAudio();
    const q = new SpeechQueue({
      language: lang,
      voice: langVoice?.identifier,
      rate,
      neural,
      provider: neural ? voiceMode : undefined,
      onFallback: (why) => addLog(`neural voice off: ${why}`),
    });
    previewRef.current = q;
    q.push(ttsText);
    q.flush();
  }, [lang, langVoice, rate, neural, voiceMode, ttsText, addLog]);

  // ─── Bench 3: the conversation loop ───────────────────────────────────────
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [thesisId, setThesisId] = useState<string | null>(null);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [pendingConfirm, setPendingConfirm] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const phaseRef = useRef<Phase>("idle");
  const loopActive = useRef(false);
  // The loop drives itself through callbacks captured at `voice.start` time, so
  // anything the user can change mid-conversation is read from a ref rather than
  // from a closed-over render value.
  const settingsRef = useRef({ thesisId, lang, rate, voiceId: langVoice?.identifier, neural, voiceMode });
  settingsRef.current = { thesisId, lang, rate, voiceId: langVoice?.identifier, neural, voiceMode };
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<SpeechQueue | null>(null);
  // Transcript for THIS turn. Android ends the recognition session on its own,
  // so a turn can span several sessions: `base` holds what earlier sessions
  // produced, `cur` the live one.
  const baseRef = useRef("");
  const curRef = useRef("");

  const setPhase = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  useEffect(() => {
    listTheses()
      .then((t) => {
        setTheses(t);
        setThesisId((prev) => prev ?? t[0]?.id ?? null);
      })
      .catch(() => {});
  }, []);

  const clearSilence = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  };

  const turnText = () => `${baseRef.current} ${curRef.current}`.trim();

  const listen = useCallback(async () => {
    if (!loopActive.current) return;
    baseRef.current = "";
    curRef.current = "";
    setHeard("");
    setPhase("listening");
    const ok = await voice.start(
      (text) => {
        curRef.current = text;
        setHeard(turnText());
        // Every new word resets the clock; the turn commits on silence.
        clearSilence();
        silenceTimer.current = setTimeout(() => void commitTurn(), SILENCE_MS);
      },
      {
        lang: settingsRef.current.lang,
        // Without this, the AI's own voice is transcribed as user speech and the
        // loop talks to itself.
        echoCancellation: true,
        onVolume: () => {},
        onEnd: () => {
          // The OS ended the session mid-turn — carry the transcript over and
          // start another one so the user can keep talking.
          if (phaseRef.current !== "listening" || !loopActive.current) return;
          baseRef.current = turnText();
          curRef.current = "";
          addLog("loop: recognizer restarted");
          setTimeout(() => void listen(), 150);
        },
        onError: (code) => {
          addLog(`loop error: ${code}`);
          if (code === "no-speech" && loopActive.current) {
            setTimeout(() => void listen(), 300);
          } else {
            stopLoop();
          }
        },
      },
    );
    if (!ok) {
      addLog("loop: mic refused");
      stopLoop();
    }
    // `listen` recurses through callbacks; deps are refs or stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, lang, addLog, setPhase]);

  /**
   * Run one turn: send `text`, stream the reply, speak it, hand the floor back.
   * Split out from `commitTurn` so a turn can also be TYPED — the iOS Simulator
   * has no working audio input (the recognizer fails with `audio-capture`), and
   * everything downstream of recognition is worth testing anyway.
   */
  const runTurn = useCallback(async (text: string) => {
    const { thesisId: id, lang: turnLang, rate: turnRate, voiceId } = settingsRef.current;
    if (!id) {
      addLog("loop: no thesis selected");
      stopLoop();
      return;
    }

    setPhase("thinking");
    voice.stop();
    setHeard(text);
    setReply("");
    setPendingConfirm(null);
    addLog(`→ ${text.slice(0, 60)}`);

    const queue = new SpeechQueue({
      language: turnLang,
      voice: voiceId,
      rate: turnRate,
      neural: settingsRef.current.neural,
      provider: settingsRef.current.neural ? settingsRef.current.voiceMode : undefined,
      onFallback: (why) => addLog(`neural voice off: ${why}`),
      onChunk: () => setPhase("speaking"),
      onIdle: () => {
        // The AI finished talking — hand the floor back.
        if (loopActive.current) void listen();
        else setPhase("idle");
      },
    });
    queueRef.current = queue;

    try {
      await chatSendStream(id, text, {
        onDelta: (chunk) => {
          setReply((prev) => prev + chunk);
          queue.push(chunk);
        },
        // A question from the AI is just more speech — read it out and the
        // user's spoken answer becomes the next turn.
        onAsk: (ask) => {
          addLog(`ask: ${ask.question.slice(0, 40)}`);
          queue.push(` ${ask.question} `);
        },
        // The destructive gate parked a tool until it's approved by TAP. Voice
        // can't clear it yet, so say so instead of going silent — wiring
        // chatConfirmAction into the loop is the next step.
        onConfirm: (confirm) => {
          addLog(`confirm required: ${confirm.toolName}`);
          setPendingConfirm(confirm.preview.text || confirm.toolName);
          queue.push(` ${confirm.preview.text || "This action needs your approval."} `);
        },
      });
      queue.flush();
    } catch (e: any) {
      addLog(`stream failed: ${e?.message ?? "error"}`);
      queue.stop();
      if (loopActive.current) void listen();
      else setPhase("idle");
    }
  }, [voice, listen, addLog, setPhase]);

  /** Spoken turn: commit whatever the recognizer heard once the user goes quiet. */
  const commitTurn = useCallback(async () => {
    if (phaseRef.current !== "listening") return;
    clearSilence();
    const text = turnText();
    if (!text) return;
    await runTurn(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runTurn]);

  /** Typed turn: same pipeline, no microphone. */
  const sendTyped = useCallback(async () => {
    const text = typed.trim();
    if (!text) return;
    setTyped("");
    await runTurn(text);
  }, [typed, runTurn]);

  const stopLoop = useCallback(() => {
    loopActive.current = false;
    clearSilence();
    queueRef.current?.stop();
    queueRef.current = null;
    voice.abort();
    stopSpeaking();
    setPhase("idle");
  }, [voice, setPhase]);

  const startLoop = useCallback(async () => {
    if (!thesisId) return;
    await initSpeechAudio();
    loopActive.current = true;
    addLog("loop: started");
    await listen();
  }, [thesisId, listen, addLog]);

  /** Tap while the AI talks to cut it off and take the floor (barge-in). */
  const bargeIn = useCallback(() => {
    queueRef.current?.stop();
    queueRef.current = null;
    addLog("loop: barge-in");
    if (loopActive.current) void listen();
  }, [listen, addLog]);

  // Never leave the mic hot or the synthesizer talking after navigating away.
  useEffect(() => {
    return () => {
      loopActive.current = false;
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      queueRef.current?.stop();
      stopSpeaking();
      voice.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── render ───────────────────────────────────────────────────────────────
  const card = { backgroundColor: colors.bgCard, borderColor: colors.borderSubtle };
  const blocked = diag ? !diag.moduleLinked : false;

  const phaseColor =
    phase === "listening" ? colors.semanticSuccess
    : phase === "thinking" ? colors.semanticWarning
    : phase === "speaking" ? colors.brandPrimary
    : colors.textSecondary;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bgPrimary }]} edges={["top"]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: colors.textPrimary }]}>Voice Lab</Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* 1 — diagnostics */}
        <View style={[styles.card, card]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Diagnostics</Text>
          {!diag ? (
            <ActivityIndicator color={colors.brandPrimary} />
          ) : (
            <>
              <Row label="Native module linked" value={diag.moduleLinked} colors={colors} />
              <Row label="Recognition available" value={diag.recognitionAvailable} colors={colors} />
              <Row label="On-device recognition" value={diag.onDeviceSupported} colors={colors} />
              <Row label="Audio recording" value={diag.recordingSupported} colors={colors} />
              <Row label="Mic permission" value={diag.permissionGranted} colors={colors} />
              <Row label="Voices installed" value={voices === null ? "…" : voices.length} colors={colors} />
              <Row
                label="Locales"
                value={diag.locales.length ? `${diag.locales.length} (${diag.installedLocales.length} offline)` : "—"}
                colors={colors}
              />
              {diag.defaultService ? (
                <Row label="Service" value={diag.defaultService} colors={colors} />
              ) : null}
              {blocked ? (
                <Text style={[styles.warn, { color: colors.semanticWarning }]}>
                  expo-speech-recognition isn&apos;t linked. Run{" "}
                  {Platform.OS === "ios" ? "npx expo run:ios" : "npx expo run:android"} — recognition
                  is a no-op in Expo Go. Synthesis below still works.
                </Text>
              ) : null}
            </>
          )}
        </View>

        {/* language */}
        <View style={[styles.card, card]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Language</Text>
          <View style={styles.chipRow}>
            {LANGS.map((l) => {
              const on = lang === l.code;
              return (
                <Pressable
                  key={l.code}
                  onPress={() => {
                    setLang(l.code);
                    setTtsText(SAMPLE_TEXT[l.code]);
                  }}
                  style={[
                    styles.chip,
                    { borderColor: colors.borderDefault, backgroundColor: on ? colors.brandPrimary : colors.bgSurface },
                  ]}
                >
                  <Text style={[styles.chipText, { color: on ? "#FFFFFF" : colors.textPrimary }]}>{l.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* 2a — recognition */}
        <View style={[styles.card, card]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Recognition</Text>
          <Pressable
            onPress={() => void toggleStt()}
            disabled={!voice.supported}
            style={[
              styles.micButton,
              {
                backgroundColor: !voice.supported
                  ? colors.bgSurface
                  : sttOn
                    ? colors.semanticError
                    : colors.brandPrimary,
              },
            ]}
          >
            {sttOn ? <Square size={26} color="#FFFFFF" /> : <Mic size={26} color={voice.supported ? "#FFFFFF" : colors.textPlaceholder} />}
          </Pressable>

          <View style={[styles.meterTrack, { backgroundColor: colors.bgSurface }]}>
            <View
              style={[
                styles.meterFill,
                {
                  backgroundColor: colors.semanticSuccess,
                  // volume runs about -2..10; clamp to a 0..100% width.
                  width: `${Math.max(0, Math.min(100, ((voice.volume ?? -2) + 2) * 8.3))}%`,
                },
              ]}
            />
          </View>

          <Text style={[styles.mono, { color: colors.textSecondary }]}>
            {partial || (voice.supported ? "Say something…" : "Recognition unavailable on this build")}
          </Text>
          {finals.map((f, i) => (
            <Text key={`${i}-${f.slice(0, 12)}`} style={[styles.final, { color: colors.textPrimary }]} numberOfLines={2}>
              • {f}
            </Text>
          ))}
        </View>

        {/* 2b — synthesis */}
        <View style={[styles.card, card]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Synthesis</Text>
          <TextInput
            value={ttsText}
            onChangeText={setTtsText}
            multiline
            style={[styles.input, { backgroundColor: colors.bgInput, color: colors.textPrimary, borderColor: colors.borderDefault }]}
            placeholder="Text to speak"
            placeholderTextColor={colors.textPlaceholder}
          />
          <View style={styles.chipRow}>
            {[...(caps?.providers ?? []), "device"].map((mode) => {
              const active = voiceMode === mode;
              return (
                <Pressable
                  key={mode}
                  onPress={() => setVoiceMode(mode)}
                  style={[
                    styles.chip,
                    {
                      borderColor: colors.borderDefault,
                      backgroundColor: active ? colors.brandPrimary : colors.bgSurface,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? "#FFFFFF" : colors.textPrimary }]}>
                    {VOICE_LABELS[mode] ?? mode}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {caps && !caps.enabled ? (
            <Text style={[styles.hint, { color: colors.textPlaceholder }]}>
              No server voice configured — set TTS_URL or GEMINI_API_KEY, then restart the server.
            </Text>
          ) : null}

          {neural ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Voice: {VOICE_LABELS[voiceMode] ?? voiceMode} ({lang.slice(0, 2)}) — server
            </Text>
          ) : langVoice ? (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              Voice: {langVoice.name} ({langVoice.language})
            </Text>
          ) : voices ? (
            <Text style={[styles.warn, { color: colors.semanticWarning }]}>
              No {lang} voice installed — iOS synthesizes nothing and reports no error. Add one under
              Settings → Accessibility → Spoken Content → Voices.
            </Text>
          ) : null}

          <View style={styles.chipRow}>
            <Pressable
              onPress={() => void previewVoice()}
              style={[styles.action, { backgroundColor: colors.brandPrimary }]}
            >
              <Volume2 size={16} color="#FFFFFF" />
              <Text style={styles.actionText}>Speak</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                previewRef.current?.stop();
                stopSpeaking();
              }}
              style={[styles.action, { backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.borderDefault }]}
            >
              <Square size={14} color={colors.textPrimary} />
              <Text style={[styles.actionText, { color: colors.textPrimary }]}>Stop</Text>
            </Pressable>
            <Pressable
              onPress={() => setRate((r) => (r >= 1.4 ? 0.6 : Math.round((r + 0.2) * 10) / 10))}
              style={[styles.action, { backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.borderDefault }]}
            >
              <Text style={[styles.actionText, { color: colors.textPrimary }]}>Rate {rate.toFixed(1)}×</Text>
            </Pressable>
          </View>
        </View>

        {/* 3 — the loop */}
        <View style={[styles.card, card]}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Conversation</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            Hands-free against the real chat endpoint — tools, RAG and all. Turns are saved to the
            thesis chat history.
          </Text>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.picker} contentContainerStyle={styles.chipRow}>
            {theses.map((t) => {
              const on = thesisId === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setThesisId(t.id)}
                  style={[styles.chip, { borderColor: colors.borderDefault, backgroundColor: on ? colors.brandPrimary : colors.bgSurface }]}
                >
                  <Text numberOfLines={1} style={[styles.chipText, { color: on ? "#FFFFFF" : colors.textPrimary }]}>
                    {t.title || "Untitled"}
                  </Text>
                </Pressable>
              );
            })}
            {theses.length === 0 ? (
              <Text style={[styles.hint, { color: colors.textPlaceholder }]}>No theses yet</Text>
            ) : null}
          </ScrollView>

          <View style={styles.phaseRow}>
            <View style={[styles.dot, { backgroundColor: phaseColor }]} />
            <Text style={[styles.phaseText, { color: phaseColor }]}>
              {phase === "idle" ? "Idle" : phase === "listening" ? "Listening…" : phase === "thinking" ? "Thinking…" : "Speaking — tap to interrupt"}
            </Text>
          </View>

          <View style={styles.chipRow}>
            {phase === "idle" ? (
              <Pressable
                onPress={() => void startLoop()}
                disabled={!thesisId || !voice.supported}
                style={[styles.action, { backgroundColor: !thesisId || !voice.supported ? colors.bgSurface : colors.semanticSuccess }]}
              >
                <MessageSquare size={16} color={!thesisId || !voice.supported ? colors.textPlaceholder : "#FFFFFF"} />
                <Text style={[styles.actionText, { color: !thesisId || !voice.supported ? colors.textPlaceholder : "#FFFFFF" }]}>
                  Start conversation
                </Text>
              </Pressable>
            ) : (
              <>
                <Pressable onPress={stopLoop} style={[styles.action, { backgroundColor: colors.semanticError }]}>
                  <Square size={14} color="#FFFFFF" />
                  <Text style={styles.actionText}>End</Text>
                </Pressable>
                {phase === "speaking" ? (
                  <Pressable onPress={bargeIn} style={[styles.action, { backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.borderDefault }]}>
                    <Mic size={14} color={colors.textPrimary} />
                    <Text style={[styles.actionText, { color: colors.textPrimary }]}>Interrupt</Text>
                  </Pressable>
                ) : null}
              </>
            )}
          </View>

          {/* No-mic path: exercises streaming, sentence-chunked TTS, the Arabic
              voice and barge-in without the recognizer. The iOS Simulator can't
              capture audio at all (`audio-capture`), so this is the only way to
              test the rest of the loop there. */}
          <View style={styles.chipRow}>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              onSubmitEditing={() => void sendTyped()}
              returnKeyType="send"
              style={[styles.typedInput, { backgroundColor: colors.bgInput, color: colors.textPrimary, borderColor: colors.borderDefault }]}
              placeholder="Type a turn instead (no mic)"
              placeholderTextColor={colors.textPlaceholder}
            />
            <Pressable
              onPress={() => void sendTyped()}
              disabled={!typed.trim() || !thesisId}
              style={[styles.action, { backgroundColor: !typed.trim() || !thesisId ? colors.bgSurface : colors.brandPrimary }]}
            >
              <Text style={[styles.actionText, { color: !typed.trim() || !thesisId ? colors.textPlaceholder : "#FFFFFF" }]}>Send</Text>
            </Pressable>
          </View>

          {heard ? (
            <View style={[styles.bubble, { backgroundColor: colors.chatUserBubble }]}>
              <Text style={[styles.bubbleText, { color: colors.chatUserText }]}>{heard}</Text>
            </View>
          ) : null}
          {reply ? (
            <View style={[styles.bubble, { backgroundColor: colors.chatAiBubble }]}>
              <Text style={[styles.bubbleText, { color: colors.textPrimary }]}>{reply}</Text>
            </View>
          ) : null}
          {pendingConfirm ? (
            <Text style={[styles.warn, { color: colors.semanticWarning }]}>
              Blocked on approval: {pendingConfirm} — the destructive gate needs a tap, which voice
              mode can&apos;t give yet.
            </Text>
          ) : null}
        </View>

        {/* event log */}
        <View style={[styles.card, card]}>
          <View style={styles.logHeader}>
            <Text style={[styles.cardTitle, { color: colors.textPrimary, marginBottom: 0 }]}>Events</Text>
            <Pressable onPress={() => setLog([])} hitSlop={8}>
              <Trash2 size={16} color={colors.textSecondary} />
            </Pressable>
          </View>
          {log.length === 0 ? (
            <Text style={[styles.mono, { color: colors.textPlaceholder }]}>—</Text>
          ) : (
            log.map((l, i) => (
              <Text key={`${i}-${l.slice(0, 10)}`} style={[styles.mono, { color: colors.textSecondary }]} numberOfLines={1}>
                {l}
              </Text>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  colors,
}: {
  label: string;
  value: boolean | string | number | null;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const isBool = typeof value === "boolean";
  const text = isBool ? (value ? "yes" : "no") : value === null ? "unknown" : String(value);
  const tint = isBool ? (value ? colors.semanticSuccess : colors.semanticError) : colors.textPrimary;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: tint }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 10 },
  title: { fontSize: 17, fontWeight: "600" },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "600", marginBottom: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 13, flexShrink: 1 },
  rowValue: { fontSize: 13, fontWeight: "600", flexShrink: 1, textAlign: "right" },
  warn: { fontSize: 12, lineHeight: 17, marginTop: 6 },
  hint: { fontSize: 12, lineHeight: 17 },
  chipRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", alignItems: "center" },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1, maxWidth: 180 },
  chipText: { fontSize: 13, fontWeight: "500" },
  picker: { marginVertical: 4 },
  micButton: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", alignSelf: "center", marginVertical: 6 },
  meterTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  meterFill: { height: 6, borderRadius: 3 },
  mono: { fontSize: 12, lineHeight: 17 },
  final: { fontSize: 13, lineHeight: 19 },
  input: { minHeight: 72, borderRadius: 10, borderWidth: 1, padding: 10, fontSize: 14, textAlignVertical: "top" },
  typedInput: { flexGrow: 1, flexShrink: 1, minWidth: 160, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14 },
  action: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  actionText: { fontSize: 13, fontWeight: "600", color: "#FFFFFF" },
  phaseRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  phaseText: { fontSize: 13, fontWeight: "600" },
  bubble: { borderRadius: 12, padding: 10, marginTop: 6 },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  logHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
