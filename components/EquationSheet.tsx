import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { Check, Sparkles, TriangleAlert } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useSettingsStore } from "@/stores/settings-store";
import { useRTL } from "@/hooks/useRTL";
import {
  MATH_SYMBOLS,
  insertSymbol,
  useEquationSheetStore,
  type MathSymbol,
} from "@/stores/equation-sheet-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { askThesisEquationAI, insertThesisEquation, previewThesisEquation, updateThesisEquation } from "@/lib/api";
import MathPreview from "@/components/workspace/MathPreview";
import { visualRow, visualTextAlign } from "@/lib/rtl-layout";

/** How much of the screen the sheet covers. The student is placing an equation in a
 *  document they need to keep seeing, so it stops short of the top. */
export const EQUATION_SHEET_FRACTION = 0.7;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const PAD = 16;
/** Debounce before typesetting: long enough not to fire on every keystroke, short
 *  enough that the preview still feels live while typing a formula. */
const PREVIEW_MS = 320;

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level bottom push drawer for Word's Insert → Equation.
 *
 * An equation is a document OBJECT, not a line of text — Word keeps it in its own
 * structure, outside the paragraph's words — so it gets the same treatment as a
 * caption: its own surface, with a LaTeX field, a live preview of the real
 * typeset result, and a symbol palette. The block bubble opens it.
 *
 * Wrap the app with it once, at the root, like CaptionSheet.
 */
export function EquationSheet({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const DRAWER_H = Math.round(height * EQUATION_SHEET_FRACTION);

  const open = useEquationSheetStore((s) => s.open);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const openSV = useSharedValue(open);

  const close = () => useEquationSheetStore.getState().close();

  useEffect(() => {
    openSV.value = open;
  }, [open, openSV]);

  useAnimatedReaction(
    () => (dragging.value ? -1 : openSV.value ? 1 : 0),
    (target) => {
      if (target >= 0) progress.value = withSpring(target, SPRING);
    },
  );

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open]);

  const dragPan = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          dragging.value = true;
        })
        .onUpdate((e) => {
          progress.value = clamp(1 - e.translationY / DRAWER_H, 0, 1);
        })
        .onEnd((e) => {
          const keep = progress.value > 0.55 && e.velocityY < 800;
          openSV.value = keep;
          dragging.value = false;
          if (!keep) runOnJS(close)();
        })
        .onFinalize(() => {
          dragging.value = false;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [DRAWER_H],
  );

  const appStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -progress.value * (insets.top + 6) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.94]) },
    ],
    borderRadius: progress.value * 16,
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * (DRAWER_H + 40) }],
  }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.app, appStyle]}>{children}</Animated.View>

      {/* No dim: the line the equation goes on must stay visible behind the sheet. */}
      <View style={[StyleSheet.absoluteFill, styles.tapCatcher]} pointerEvents={open ? "auto" : "none"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </View>

      <Animated.View style={[styles.drawer, { height: DRAWER_H }, drawerStyle]} pointerEvents={open ? "auto" : "none"}>
        {/* Unmounted while closed — the preview is a WebView, and it must not
            outlive the equation it was previewing. */}
        {open ? <EquationPanel dragPan={dragPan} bottomInset={insets.bottom} /> : null}
      </Animated.View>
    </View>
  );
}

function EquationPanel({ dragPan, bottomInset }: { dragPan: ReturnType<typeof Gesture.Pan>; bottomInset: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { isRTL: appRtl } = useRTL();
  const dark = useSettingsStore((s) => s.theme) === "dark";
  const rowDir = visualRow(appRtl);
  const textAlign = visualTextAlign(appRtl);

  const thesisId = useEquationSheetStore((s) => s.thesisId);
  const mode = useEquationSheetStore((s) => s.mode);
  const index = useEquationSheetStore((s) => s.index);
  const initialLatex = useEquationSheetStore((s) => s.latex);
  const number = useEquationSheetStore((s) => s.number);
  const editing = mode === "edit";

  const [latex, setLatex] = useState(initialLatex);
  const [selection, setSelection] = useState({ start: initialLatex.length, end: initialLatex.length });
  const [mathml, setMathml] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [group, setGroup] = useState(MATH_SYMBOLS[0].key);
  const [ask, setAsk] = useState("");
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<TextInput>(null);
  // Set by a symbol chip: the caret position to restore once the new value renders.
  const pendingCaret = useRef<number | null>(null);

  const errorMsg = t("common.error", { defaultValue: "Something went wrong" });

  // The sheet covers most of the screen, so scroll the target line into the strip
  // that's left — the student is placing an equation relative to something.
  const revealNonce = useEquationSheetStore((s) => s.revealNonce);
  useEffect(() => {
    useWorkspaceStore.getState().requestScrollToBlock(index);
  }, [revealNonce, index]);

  // Live preview. The server both VALIDATES and typesets, so a formula that would
  // not parse is caught here — in front of the student, while they are still
  // typing it — rather than being written into the document as a broken equation.
  useEffect(() => {
    const src = latex.trim();
    if (!thesisId || !src) {
      setMathml("");
      setError(null);
      return;
    }
    let alive = true;
    setChecking(true);
    const timer = setTimeout(() => {
      previewThesisEquation(thesisId, src)
        .then((res) => {
          if (!alive) return;
          if (res.ok) {
            setMathml(res.mathml);
            setError(null);
          } else {
            // Keep the LAST good rendering on screen: blanking it on every
            // half-typed `\fra` makes the preview flicker rather than inform.
            setError(res.error);
          }
          setChecking(false);
        })
        .catch(() => {
          if (!alive) return;
          setChecking(false);
        });
    }, PREVIEW_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [latex, thesisId]);

  // The AI writes the LaTeX; the student keeps or discards it. The reply goes into
  // the field (which re-previews it) rather than into the document, so an equation
  // is never written by a model without being seen typeset first.
  const runAsk = () => {
    const q = ask.trim();
    if (!thesisId || !q || asking) return;
    setAsking(true);
    Keyboard.dismiss();
    void (async () => {
      try {
        const res = await askThesisEquationAI(thesisId, { prompt: q, ...(latex.trim() ? { latex: latex.trim() } : null) });
        if (res.ok) {
          setLatex(res.latex);
          // The server already typeset it — show that immediately instead of
          // waiting for the debounced preview to make the same round trip.
          setMathml(res.mathml);
          setError(null);
          setAsk("");
          pendingCaret.current = null;
          setSelection({ start: res.latex.length, end: res.latex.length });
        } else {
          setError(res.error);
        }
      } catch (e: any) {
        Alert.alert(e?.message ?? errorMsg);
      } finally {
        setAsking(false);
      }
    })();
  };

  const tapSymbol = (sym: MathSymbol) => {
    const next = insertSymbol(latex, selection, sym);
    setLatex(next.value);
    pendingCaret.current = next.caret;
    setSelection({ start: next.caret, end: next.caret });
    inputRef.current?.focus();
  };

  const dirty = latex.trim() !== initialLatex.trim();
  const canSave = !!latex.trim() && !saving && !error && (!editing || dirty);

  const submit = () => {
    const src = latex.trim();
    if (!thesisId || !src || saving) return;
    setSaving(true);
    Keyboard.dismiss();
    void (async () => {
      try {
        const res = editing
          ? await updateThesisEquation(thesisId, index, src)
          : await insertThesisEquation(thesisId, { latex: src, afterIndex: index });
        // Inserting shifts every later block index by +1, so nothing optimistic
        // here: the echoed document is the new source of truth.
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
        useEquationSheetStore.getState().close();
      } catch (e: any) {
        Alert.alert(e?.message ?? errorMsg);
      } finally {
        setSaving(false);
      }
    })();
  };

  const chip = (active: boolean) => [
    styles.symChip,
    {
      backgroundColor: active ? colors.brandPrimary : colors.bgSurface,
      borderColor: active ? colors.brandPrimary : colors.borderDefault,
    },
  ];
  const chipText = (active: boolean) => [
    styles.symChipText,
    { color: active ? colors.bgPrimary : colors.textPrimary },
  ];

  const groupLabels: Record<string, string> = {
    structure: t("workspace.equation.structure", { defaultValue: "Structure" }),
    greek: t("workspace.equation.greek", { defaultValue: "Greek" }),
    operators: t("workspace.equation.operators", { defaultValue: "Operators" }),
    functions: t("workspace.equation.functions", { defaultValue: "Functions" }),
  };
  const symbols = MATH_SYMBOLS.find((g) => g.key === group)?.symbols ?? [];

  return (
    <View style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
      <GestureDetector gesture={dragPan}>
        <View style={styles.grabZone}>
          <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            {editing
              ? t("workspace.equation.editTitle", { defaultValue: "Edit equation" })
              : t("workspace.equation.insertTitle", { defaultValue: "Insert equation" })}
          </Text>
        </View>
      </GestureDetector>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: PAD, paddingBottom: PAD + bottomInset + 8, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* The real typeset result — the same MathJax the Writer uses, so what is
            previewed here is exactly what lands on the page. */}
        <View style={[styles.preview, { borderColor: colors.borderDefault, backgroundColor: colors.bgSurface }]}>
          {/* The preview is a WebView, so it is mounted only once there is
              something to typeset. An empty sheet costs nothing to open, and the
              first formula is what brings the typesetter up. */}
          {mathml ? (
            <MathPreview
              mathml={mathml}
              dark={dark}
              dom={{ style: { height: 92, backgroundColor: "transparent" }, scrollEnabled: false }}
            />
          ) : (
            <View style={styles.previewEmpty}>
              <Text style={[styles.previewEmptyText, { color: colors.textPlaceholder }]}>
                {t("workspace.equation.previewEmpty", { defaultValue: "Your equation appears here" })}
              </Text>
            </View>
          )}
          {number ? (
            <Text style={[styles.numberTag, { color: colors.textSecondary, textAlign }]}>
              {t("workspace.equation.keepsNumber", { defaultValue: "Keeps its number {{number}}", number })}
            </Text>
          ) : null}
        </View>

        {/* The parse error, verbatim from the typesetter — "Undefined control
            sequence \fra" tells the student exactly what to fix. */}
        {error ? (
          <View style={[{ flexDirection: rowDir }, styles.errorRow]}>
            <TriangleAlert size={15} color={colors.semanticError} strokeWidth={2.2} />
            <Text style={[styles.errorText, { color: colors.semanticError, textAlign }]} numberOfLines={3}>
              {error}
            </Text>
          </View>
        ) : null}

        {/* Ask the AI in words. Nobody should need LaTeX to get an equation — but
            what comes back lands in the FIELD, typeset above, not in the document:
            the student still reads it and decides. */}
        <View style={{ gap: 7 }}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
            {t("workspace.equation.ask", { defaultValue: "Ask AI" })}
          </Text>
          <View style={[{ flexDirection: rowDir }, styles.askRow]}>
            <TextInput
              value={ask}
              onChangeText={setAsk}
              onSubmitEditing={runAsk}
              returnKeyType="send"
              editable={!asking}
              placeholder={
                editing
                  ? t("workspace.equation.askEditPlaceholder", { defaultValue: "Change it… e.g. add a shear term" })
                  : t("workspace.equation.askPlaceholder", { defaultValue: "Describe it… e.g. area of a circle" })
              }
              placeholderTextColor={colors.textPlaceholder}
              style={[
                styles.askInput,
                { borderColor: colors.borderDefault, color: colors.textPrimary, backgroundColor: colors.bgSurface },
                { textAlign },
              ]}
            />
            <Pressable
              onPress={runAsk}
              disabled={!ask.trim() || asking}
              style={[
                styles.askBtn,
                { backgroundColor: colors.brandPrimary, opacity: !ask.trim() || asking ? 0.5 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.equation.ask", { defaultValue: "Ask AI" })}
            >
              {asking ? (
                <ActivityIndicator size="small" color={colors.brandOnPrimary} />
              ) : (
                <Sparkles size={17} color={colors.brandOnPrimary} strokeWidth={2.2} />
              )}
            </Pressable>
          </View>
        </View>

        <View style={{ gap: 7 }}>
          <View style={[{ flexDirection: rowDir }, styles.fieldHead]}>
            <Text style={[styles.fieldLabel, { color: colors.textSecondary, textAlign }]}>
              {t("workspace.equation.field", { defaultValue: "Formula (LaTeX)" })}
            </Text>
            {checking ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
          </View>
          <TextInput
            ref={inputRef}
            value={latex}
            onChangeText={setLatex}
            selection={pendingCaret.current !== null ? selection : undefined}
            onSelectionChange={(e) => {
              pendingCaret.current = null;
              setSelection(e.nativeEvent.selection);
            }}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            placeholder="\frac{a}{b}"
            placeholderTextColor={colors.textPlaceholder}
            style={[
              styles.input,
              { borderColor: colors.borderDefault, color: colors.textPrimary, backgroundColor: colors.bgSurface },
            ]}
            // LaTeX is LTR even when the app is in Arabic.
            textAlign="left"
          />
        </View>

        {/* Symbol palette — nobody should have to remember that a square root is
            \sqrt{}. Tapping wraps the current selection when there is one. */}
        <View style={{ gap: 9 }}>
          <View style={[styles.wrap, { flexDirection: rowDir }]}>
            {MATH_SYMBOLS.map((g) => (
              <Pressable key={g.key} onPress={() => setGroup(g.key)} style={chip(group === g.key)} accessibilityRole="button">
                <Text style={chipText(group === g.key)}>{groupLabels[g.key] ?? g.key}</Text>
              </Pressable>
            ))}
          </View>
          <View style={[styles.wrap, { flexDirection: rowDir }]}>
            {symbols.map((sym) => (
              <Pressable
                key={sym.label}
                onPress={() => tapSymbol(sym)}
                style={[styles.symBtn, { borderColor: colors.borderDefault, backgroundColor: colors.bgSurface }]}
                accessibilityRole="button"
                accessibilityLabel={sym.label}
              >
                <Text style={[styles.symBtnText, { color: colors.textPrimary }]}>{sym.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[{ flexDirection: rowDir }, styles.actions]}>
          <Pressable
            onPress={() => useEquationSheetStore.getState().close()}
            disabled={saving}
            style={[styles.secondaryBtn, { borderColor: colors.borderDefault }]}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, { color: colors.textPrimary }]}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Text>
          </Pressable>
          <Pressable
            onPress={submit}
            disabled={!canSave}
            style={[styles.primaryBtn, { backgroundColor: colors.brandPrimary, opacity: canSave ? 1 : 0.5 }]}
            accessibilityRole="button"
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.brandOnPrimary} />
            ) : (
              <Check size={17} color={colors.brandOnPrimary} strokeWidth={2.4} />
            )}
            <Text style={[styles.btnText, { color: colors.brandOnPrimary }]}>
              {editing ? t("common.save", { defaultValue: "Save" }) : t("workspace.equation.insert", { defaultValue: "Insert" })}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  app: { flex: 1, overflow: "hidden", backgroundColor: "transparent" },
  tapCatcher: { zIndex: 1 },
  drawer: { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 2 },
  panel: {
    flex: 1,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 20,
  },
  grabZone: { paddingTop: 10, paddingBottom: 8, alignItems: "center" },
  grab: { width: 44, height: 5, borderRadius: 3, marginBottom: 10 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },

  preview: { borderWidth: 1, borderRadius: 12, overflow: "hidden", paddingBottom: 2 },
  previewEmpty: { height: 92, alignItems: "center", justifyContent: "center" },
  previewEmptyText: { fontSize: 13.5 },
  numberTag: { fontSize: 11.5, paddingHorizontal: 12, paddingBottom: 8 },

  errorRow: { alignItems: "flex-start", gap: 7 },
  errorText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  fieldHead: { alignItems: "center", justifyContent: "space-between", gap: 8 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  input: {
    minHeight: 82,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 14.5,
    // Monospace: LaTeX is code, and the braces must line up while typing it.
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  wrap: { flexWrap: "wrap", gap: 8 },

  askRow: { alignItems: "center", gap: 8 },
  askInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, fontSize: 14 },
  askBtn: { width: 46, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  symChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, borderWidth: 1 },
  symChipText: { fontSize: 12.5, fontFamily: "Inter_600SemiBold" },
  symBtn: { minWidth: 46, paddingHorizontal: 10, height: 42, borderRadius: 11, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  symBtnText: { fontSize: 16 },

  actions: { alignItems: "center", gap: 10, marginTop: 4 },
  secondaryBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  primaryBtn: { flex: 1.4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 12, borderRadius: 12 },
  btnText: { fontSize: 13.5, fontFamily: "Inter_700Bold" },
});
