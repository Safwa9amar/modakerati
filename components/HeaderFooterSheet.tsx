import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
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
import { Check, ChevronDown, ChevronUp, LayoutTemplate, PanelBottom, PanelTop, Send, Sparkles, X } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useRTL } from "@/hooks/useRTL";
import { useHfSheetStore, type HfRegion } from "@/stores/hf-sheet-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { chromeOp, listHfTemplates, type HfPreviewLine, type HfPreviewSeg, type HfTemplateSummary } from "@/lib/api";
import { estimateTokenCount } from "@/lib/thinking";

/** How much of the screen the sheet covers. Exported because the Writer has to know
 *  what's LEFT — it scrolls the band being edited into that strip. Kept under two
 *  thirds on purpose: the student is editing something they need to SEE, and the panel
 *  scrolls internally when a preview pushes it past this. */
export const HF_SHEET_FRACTION = 0.62;
const SPRING = { damping: 22, stiffness: 240, mass: 0.7 } as const;
const PAD = 16;

function clamp(v: number, lo: number, hi: number): number {
  "worklet";
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Root-level bottom push drawer for the document's running header / footer — the same
 * surface as the Insert menu (BottomInsertDrawer): opening slides the panel up while
 * the whole app recedes behind it.
 *
 * This replaces the floating chrome bubble. A header/footer band's entire toolset is
 * one ✦ flow — an instruction input, a compiled preview to approve, and the
 * university's Studio templates — which never fit in a pill hovering over the page
 * (worst in the vertical toolbar, where it had ~270px). Tapping a band opens this
 * instead; so does the section bubble's "+" for a section that has no header or footer
 * yet.
 *
 * Wrap the app with it once, at the root, like BottomInsertDrawer.
 */
export function HeaderFooterSheet({ children }: { children: React.ReactNode }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const DRAWER_H = Math.round(height * HF_SHEET_FRACTION);

  const open = useHfSheetStore((s) => s.open);
  const progress = useSharedValue(0);
  const dragging = useSharedValue(false);
  const openSV = useSharedValue(open);

  const close = () => useHfSheetStore.getState().close();

  useEffect(() => {
    openSV.value = open;
    if (open) Keyboard.dismiss();
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
  const drawerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - progress.value) * (DRAWER_H + 40) }] }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.app, appStyle]}>{children}</Animated.View>

      {/* No dim over the document — the whole point of the sheet is that the band it
          edits stays VISIBLE behind it. This layer is a transparent tap-to-dismiss
          catcher, nothing more. */}
      <View style={[StyleSheet.absoluteFill, styles.tapCatcher]} pointerEvents={open ? "auto" : "none"}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </View>

      <Animated.View style={[styles.drawer, { height: DRAWER_H }, drawerStyle]} pointerEvents={open ? "auto" : "none"}>
        {/* Unmounted while closed so the AI draft, the template list and their fetches
            don't outlive the band they belong to — the same reason the old panel was
            keyed by band. */}
        {open ? <HfPanel dragPan={dragPan} bottomInset={insets.bottom} /> : null}
      </Animated.View>
    </View>
  );
}

/** The sheet's contents. Two modes, driven by the store's `region`:
 *  • null → ADD: the section has no header and/or no footer, so offer to create one;
 *  • set  → EDIT: the ✦ flow for that band, plus the template picker. */
function HfPanel({ dragPan, bottomInset }: { dragPan: ReturnType<typeof Gesture.Pan>; bottomInset: number }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { isRTL: appRtl } = useRTL();
  const rowDir = appRtl ? "row-reverse" : "row";
  const textAlign = appRtl ? "right" : "left";

  const thesisId = useHfSheetStore((s) => s.thesisId);
  const index = useHfSheetStore((s) => s.index);
  const region = useHfSheetStore((s) => s.region);
  const bandText = useHfSheetStore((s) => s.text);
  const canAddHeader = useHfSheetStore((s) => s.canAddHeader);
  const canAddFooter = useHfSheetStore((s) => s.canAddFooter);
  const chromeSug = useSuggestionStore((s) => s.chrome);

  const [aiText, setAiText] = useState("");
  const [tplStatus, setTplStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tplList, setTplList] = useState<HfTemplateSummary[]>([]);
  const [applyingTplId, setApplyingTplId] = useState<string | null>(null);
  const [expandedTplId, setExpandedTplId] = useState<string | null>(null);
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);

  // A fresh band means a fresh draft — the instruction, the fill values and which
  // template row is open all belong to the band being edited.
  useEffect(() => {
    setAiText("");
    setTokenValues({});
  }, [region, index]);

  const zoneLabel =
    region === "footer"
      ? t("workspace.hf.bottomOfPage", { defaultValue: "Bottom of every page" })
      : t("workspace.hf.topOfPage", { defaultValue: "Top of every page" });

  const sug = chromeSug && chromeSug.index === index ? chromeSug : null;
  const busy = sug?.status === "loading";
  const ready = sug?.status === "ready";
  const errored = sug?.status === "error";
  const proposedLines: HfPreviewLine[] = (region === "footer" ? sug?.preview?.footer : sug?.preview?.header) ?? [];
  // Live token estimate for the thinking label — an approximation (see lib/thinking.ts),
  // not the provider's billed usage.
  const busyTokenCount = sug?.reasoning ? estimateTokenCount(sug.reasoning) : 0;
  const busyTokenSuffix =
    busyTokenCount > 0 ? ` · ${t("chat.tokenCount", { count: busyTokenCount, defaultValue: `${busyTokenCount} tokens` })}` : "";

  const errorMsg = t("common.error", { defaultValue: "Something went wrong" });

  // ── Create a missing part (the old section-bubble "Add header / Add footer") ──
  // `setHeaderText` / `setFooter` create the part server-side even from empty; the
  // echoed document re-renders the band. The sheet then switches to editing it, so the
  // student lands directly in "now change it".
  const addPart = (r: HfRegion) => {
    if (!thesisId || creating) return;
    setCreating(true);
    void (async () => {
      try {
        const res = await chromeOp(
          thesisId,
          r === "header"
            ? { op: "setHeaderText", index, text: "" }
            : // A new footer defaults to centred page numbers — the most common real footer.
              { op: "setFooter", index, text: "", pageNumbers: true, alignment: "center" },
        );
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
        useHfSheetStore.getState().editRegion(r, "");
      } catch {
        Alert.alert(errorMsg);
      } finally {
        setCreating(false);
      }
    })();
  };

  const submit = () => {
    const instruction = aiText.trim();
    if (!thesisId || !region || !instruction) return;
    void useSuggestionStore
      .getState()
      .requestChrome(thesisId, index, region === "footer" ? "bottom" : "top", bandText, instruction);
    Keyboard.dismiss();
  };
  const approve = () => {
    if (!thesisId) return;
    // The applied model may be a table / multi-segment / logo result — not
    // representable as a flat `text` patch, so nothing optimistic here. The doc echo
    // updates sections[], and the band re-renders from that.
    useSuggestionStore.getState().approveChrome(thesisId);
    useHfSheetStore.getState().setPreview(null);
    useHfSheetStore.getState().close();
  };
  const reject = () => {
    useSuggestionStore.getState().rejectChrome();
    setAiText("");
  };

  // Fetch on first reveal, then refresh in place so newly authored Studio templates
  // show up without a loading flash.
  useEffect(() => {
    if (!region) return;
    let alive = true;
    setTplStatus((s) => (s === "ready" ? s : "loading"));
    listHfTemplates()
      .then(({ templates }) => {
        if (!alive) return;
        setTplList(templates);
        setExpandedTplId((cur) => (cur && templates.some((x) => x.id === cur) ? cur : null));
        setTplStatus("ready");
      })
      .catch(() => {
        if (alive) setTplStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [region]);

  const applyTemplate = (templateId: string, values?: Record<string, string>) => {
    if (!thesisId || !region || applyingTplId) return;
    setApplyingTplId(templateId);
    void (async () => {
      try {
        const res = await chromeOp(thesisId, { op: "applyTemplate", index, templateId, region, values });
        if (res.document) useThesisDocStore.getState().setDoc(thesisId, res.document);
        // The echoed document now carries the real band — drop the preview before
        // closing so nothing tries to restore a stale original over it.
        useHfSheetStore.getState().setPreview(null);
        useHfSheetStore.getState().close();
      } catch {
        Alert.alert(errorMsg);
      } finally {
        setApplyingTplId(null);
      }
    })();
  };

  /** Localize a preview field token; page numbers stay universal symbols. */
  const fieldToken = (field: string): string => {
    switch (field) {
      case "pageNumber": return "#";
      case "totalPages": return "# / #";
      case "styleRef": return t("workspace.hf.field.chapter", { defaultValue: "⟨chapter⟩" });
      case "docTitle": return t("workspace.hf.field.title", { defaultValue: "⟨title⟩" });
      case "author": return t("workspace.hf.field.author", { defaultValue: "⟨author⟩" });
      case "university": return t("workspace.hf.field.university", { defaultValue: "⟨university⟩" });
      case "date": return t("workspace.hf.field.date", { defaultValue: "⟨date⟩" });
      default: return "⟨…⟩";
    }
  };
  /** A student-fillable {token}: the live draft value once typed, else the
   *  {placeholder}, so the preview reads as "this slot gets filled". */
  const segText = (seg: HfPreviewSeg, values?: Record<string, string>): string =>
    "text" in seg ? seg.text
      : "logo" in seg ? "🖼"
      : "token" in seg ? (values && values[seg.token] ? values[seg.token] : `{${seg.token}}`)
      : fieldToken(seg.field);
  /** "left_cell_text" → "Left cell text" for the fill-form label. */
  const humanizeToken = (name: string): string => {
    const s = name.replace(/[_-]+/g, " ").trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
  };

  // Preview lines show real DOCUMENT content, so a right/left header reads
  // right-to-left in an Arabic thesis. The DTO carries no direction flag, so this
  // follows the UI language — the same approximation the old panel made.
  const docRtl = appRtl;

  const renderLine = (line: HfPreviewLine, li: number, values?: Record<string, string>) => (
    <View key={li} style={{ flexDirection: docRtl ? "row-reverse" : "row", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      {line.map((slot, si) => (
        <Text
          key={si}
          numberOfLines={1}
          style={{
            flex: line.length > 1 ? 1 : undefined,
            fontSize: 12.5,
            color: colors.textPrimary,
            textAlign: si === 0 ? (docRtl ? "right" : "left") : si === line.length - 1 ? (docRtl ? "left" : "right") : "center",
          }}
        >
          {slot.map((s) => segText(s, values)).join(" ") || " "}
        </Text>
      ))}
    </View>
  );

  const previewCard = (lines: HfPreviewLine[], values?: Record<string, string>) => (
    // No zone caption per card — the sheet's title already says which band this is, and
    // repeating it above every template just crowds the previews.
    <View style={[styles.previewCard, { borderColor: colors.borderDefault, backgroundColor: colors.bgCard }]}>
      {lines.length ? (
        <>
          {lines.map((l, i) => renderLine(l, i, values))}
          {region === "header" ? <View style={styles.headerRule} /> : null}
        </>
      ) : (
        <Text style={{ fontSize: 12, color: colors.textSecondary, textAlign }}>
          {t("workspace.hf.previewNone", { defaultValue: "No preview" })}
        </Text>
      )}
    </View>
  );

  // ── LIVE preview on the real band ──
  // Whatever the student is looking at — an open template card (with the {token}
  // values as typed) or a ready AI proposal — is drawn on the actual band in the
  // Writer, so "preview" means seeing it in the document, not just on a card. Cleared
  // when nothing is being considered, and on close, so the band snaps back to what is
  // genuinely saved. Debounced: typing a token value would otherwise cross the
  // native↔DOM bridge on every keystroke.
  const previewLines: HfPreviewLine[] | null = ready
    ? proposedLines
    : expandedTplId
      ? ((region === "footer"
          ? tplList.find((x) => x.id === expandedTplId)?.preview?.footer
          : tplList.find((x) => x.id === expandedTplId)?.preview?.header) ?? null)
      : null;
  // Only the FIRST line maps onto a band (the band renders one row of positioned
  // segments); each slot becomes a segment, and their join is the flat-text fallback
  // the footer band renders.
  const previewSegments = useMemo(() => {
    const line = previewLines?.[0];
    if (!line) return null;
    return line.map((slot) => slot.map((seg) => segText(seg, ready ? undefined : tokenValues)).join(" ").trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewLines, tokenValues, ready]);
  const previewKey = previewSegments ? previewSegments.join("\u0000") : null;
  useEffect(() => {
    if (!previewSegments) {
      useHfSheetStore.getState().setPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      useHfSheetStore.getState().setPreview({
        segments: previewSegments,
        text: previewSegments.filter(Boolean).join("  "),
      });
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  const grab = (
    <GestureDetector gesture={dragPan}>
      <View style={styles.grabZone}>
        <View style={[styles.grab, { backgroundColor: colors.borderDefault }]} />
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {region
            ? zoneLabel
            : t("workspace.hf.addHeaderFooter", { defaultValue: "Add header / footer" })}
        </Text>
      </View>
    </GestureDetector>
  );

  // ── ADD mode ──
  if (!region) {
    const addRow = (r: HfRegion, Icon: typeof PanelTop, label: string) => (
      <Pressable
        key={r}
        onPress={() => addPart(r)}
        disabled={creating}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.addRow, { flexDirection: rowDir, borderColor: colors.borderDefault, backgroundColor: colors.bgCard, opacity: creating ? 0.6 : 1 }]}
      >
        <View style={[styles.addIcon, { backgroundColor: colors.brandPrimary + "22" }]}>
          <Icon size={20} color={colors.brandPrimary} strokeWidth={2.2} />
        </View>
        <Text style={[styles.addLabel, { color: colors.textPrimary, textAlign }]}>{label}</Text>
        {creating ? <ActivityIndicator size="small" color={colors.brandPrimary} /> : null}
      </Pressable>
    );
    return (
      <View style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
        {grab}
        <ScrollView contentContainerStyle={{ padding: PAD, gap: 10, paddingBottom: bottomInset + 16 }}>
          <Text style={[styles.hint, { color: colors.textSecondary, textAlign }]}>
            {t("workspace.hf.addHint", { defaultValue: "Choose what this section should repeat on every page." })}
          </Text>
          {canAddHeader ? addRow("header", PanelTop, t("workspace.hf.addHeader", { defaultValue: "Add header" })) : null}
          {canAddFooter ? addRow("footer", PanelBottom, t("workspace.hf.addFooter", { defaultValue: "Add footer" })) : null}
        </ScrollView>
      </View>
    );
  }

  // ── EDIT mode ──
  return (
    <View style={[styles.panel, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
      {grab}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: PAD, gap: 12, paddingBottom: bottomInset + 16 }}
      >
        {ready ? (
          <>
            {previewCard(proposedLines)}
            <View style={{ flexDirection: rowDir, gap: 10 }}>
              <Pressable
                onPress={approve}
                accessibilityRole="button"
                accessibilityLabel={t("common.approve", { defaultValue: "Approve" })}
                style={[styles.primaryBtn, { backgroundColor: colors.brandPrimary }]}
              >
                <Check size={17} color={colors.bgPrimary} strokeWidth={2.4} />
                <Text style={[styles.primaryBtnText, { color: colors.bgPrimary }]}>{t("common.approve", { defaultValue: "Approve" })}</Text>
              </Pressable>
              <Pressable
                onPress={reject}
                accessibilityRole="button"
                accessibilityLabel={t("common.reject", { defaultValue: "Dismiss" })}
                style={[styles.secondaryBtn, { borderColor: colors.borderDefault }]}
              >
                <X size={17} color={colors.textPrimary} strokeWidth={2.2} />
                <Text style={[styles.primaryBtnText, { color: colors.textPrimary }]}>{t("common.reject", { defaultValue: "Dismiss" })}</Text>
              </Pressable>
            </View>
          </>
        ) : busy ? (
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 10, minHeight: 44 }}>
            <Sparkles size={16} color={colors.brandPrimary} strokeWidth={2.2} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, color: colors.textSecondary, textAlign }}>
              {t("suggestion.thinking", { defaultValue: "Thinking…" })}
              {busyTokenSuffix}
            </Text>
          </View>
        ) : (
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 10 }}>
            <TextInput
              value={aiText}
              onChangeText={setAiText}
              placeholder={errored ? t("suggestion.noneRetry", { defaultValue: "No suggestion — try again" }) : t("workspace.hf.aiPlaceholder", { defaultValue: "Ask AI to change this…" })}
              placeholderTextColor={colors.textPlaceholder}
              returnKeyType="send"
              onSubmitEditing={submit}
              style={[styles.input, { color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgCard, textAlign }]}
            />
            <Pressable
              onPress={submit}
              accessibilityRole="button"
              accessibilityLabel={t("workspace.hf.aiEdit", { defaultValue: "Ask AI to change" })}
              style={[styles.sendBtn, { backgroundColor: colors.brandPrimary }]}
            >
              <Send size={18} color={colors.bgPrimary} strokeWidth={2.2} style={appRtl ? { transform: [{ scaleX: -1 }] } : undefined} />
            </Pressable>
          </View>
        )}

        {/* Templates — a full list here rather than a collapsed row: this is a sheet,
            there is room, and picking a ready-made header is the fastest path for most
            students. */}
        <View style={{ flexDirection: rowDir, alignItems: "center", gap: 7, marginTop: 4 }}>
          <LayoutTemplate size={14} color={colors.textSecondary} strokeWidth={2} />
          <Text style={{ fontSize: 12, color: colors.textSecondary, textAlign }}>
            {t("workspace.hf.orChooseTemplate", { defaultValue: "Or choose a template" })}
          </Text>
        </View>

        {tplStatus === "loading" ? (
          <View style={{ flexDirection: rowDir, alignItems: "center", gap: 8, minHeight: 44 }}>
            <ActivityIndicator size="small" color={colors.brandPrimary} />
            <Text style={{ fontSize: 13, color: colors.textSecondary }}>{t("common.loading", { defaultValue: "Loading…" })}</Text>
          </View>
        ) : tplStatus === "error" ? (
          <Pressable onPress={() => setTplStatus("idle")} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign }}>
              {t("workspace.hf.templatesError", { defaultValue: "Couldn't load templates — tap to retry" })}
            </Text>
          </Pressable>
        ) : tplList.length === 0 ? (
          <View style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={{ fontSize: 13, color: colors.textSecondary, textAlign }}>
              {t("workspace.hf.templatesEmpty", { defaultValue: "No templates yet" })}
            </Text>
          </View>
        ) : (
          tplList.map((tpl) => {
            const isOpen = expandedTplId === tpl.id;
            const applying = applyingTplId === tpl.id;
            const caption = [tpl.university, tpl.language ? tpl.language.toUpperCase() : ""].filter(Boolean).join(" · ");
            const lines: HfPreviewLine[] = (region === "footer" ? tpl.preview?.footer : tpl.preview?.header) ?? [];
            const tokens = tpl.tokens ?? [];
            return (
              <View key={tpl.id} style={[styles.tplCard, { borderColor: isOpen ? colors.brandPrimary : colors.borderDefault, backgroundColor: colors.bgCard }]}>
                <Pressable
                  onPress={() => {
                    setExpandedTplId(isOpen ? null : tpl.id);
                    setTokenValues({});
                  }}
                  accessibilityRole="button"
                  style={{ flexDirection: rowDir, alignItems: "center", gap: 11, paddingVertical: 12, paddingHorizontal: 12 }}
                >
                  <LayoutTemplate size={17} color={colors.brandPrimary} strokeWidth={2.2} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.textPrimary, textAlign }}>{tpl.name}</Text>
                    {caption ? <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textSecondary, textAlign }}>{caption}</Text> : null}
                  </View>
                  {isOpen ? <ChevronUp size={17} color={colors.textPlaceholder} strokeWidth={2.2} /> : <ChevronDown size={17} color={colors.textPlaceholder} strokeWidth={2.2} />}
                </Pressable>
                {/* Preview is ALWAYS shown, not hidden behind the expander: the point
                    of a template list is to see what each one does before committing to
                    it. Expanding only reveals the fill-in fields and Apply. A collapsed
                    row previews its raw {tokens}; the open one shows the live values as
                    they're typed. */}
                <View style={{ paddingHorizontal: 12, paddingBottom: isOpen ? 0 : 12 }}>
                  {previewCard(lines, isOpen ? tokenValues : undefined)}
                </View>
                {isOpen ? (
                  <View style={{ paddingHorizontal: 12, paddingBottom: 12, paddingTop: 10, gap: 10 }}>
                    {tokens.length ? (
                      <View style={{ gap: 8 }}>
                        <Text style={{ fontSize: 12, color: colors.textSecondary, textAlign }}>
                          {t("workspace.hf.fillTokens", { defaultValue: "Fill in the details" })}
                        </Text>
                        {tokens.map((tok) => (
                          <View key={tok} style={{ gap: 4 }}>
                            <Text style={{ fontSize: 11, fontFamily: "Inter_600SemiBold", color: colors.textPlaceholder, textAlign }}>{humanizeToken(tok)}</Text>
                            <TextInput
                              value={tokenValues[tok] ?? ""}
                              onChangeText={(v) => setTokenValues((cur) => ({ ...cur, [tok]: v }))}
                              placeholder={`{${tok}}`}
                              placeholderTextColor={colors.textPlaceholder}
                              style={[styles.tokenInput, { color: colors.textPrimary, borderColor: colors.borderDefault, backgroundColor: colors.bgPrimary, textAlign }]}
                            />
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <Pressable
                      onPress={() => applyTemplate(tpl.id, tokens.length ? tokenValues : undefined)}
                      disabled={!!applyingTplId}
                      accessibilityRole="button"
                      accessibilityLabel={t("workspace.hf.applyTemplate", { defaultValue: "Apply {{name}}", name: tpl.name })}
                      style={[styles.primaryBtn, { backgroundColor: colors.brandPrimary, opacity: applyingTplId && !applying ? 0.6 : 1 }]}
                    >
                      {applying ? <ActivityIndicator size="small" color={colors.bgPrimary} /> : <Check size={17} color={colors.bgPrimary} strokeWidth={2.4} />}
                      <Text style={[styles.primaryBtnText, { color: colors.bgPrimary }]}>{t("workspace.hf.apply", { defaultValue: "Apply" })}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
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
  hint: { fontSize: 13, lineHeight: 19 },

  addRow: { alignItems: "center", gap: 12, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  addIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  addLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },

  input: { flex: 1, height: 44, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },

  previewCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 7 },
  headerRule: { height: 1.5, backgroundColor: "#9A5A31", opacity: 0.5, borderRadius: 2, marginTop: 3 },

  primaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 12 },
  secondaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1 },
  primaryBtnText: { fontSize: 13.5, fontFamily: "Inter_700Bold" },

  tplCard: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  tokenInput: { height: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, fontSize: 14 },
});
