import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useThesisStore } from "@/stores/thesis-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useBottomSheet } from "@/stores/bottom-sheet-store";
import { getThesisOutline, type OutlineDTO, type OutlineNodeDTO } from "@/lib/api";

// Whether any heading title contains Arabic/Hebrew letters → render right-to-left.
// thesis.language is unreliable for imports, so detect direction from the content.
function isRtlText(s: string): boolean {
  return /[֐-ࣿ]/.test(s);
}

// One heading row + (recursively) all of its sub-headings, indented by depth so
// the outline reads like a table of contents. Top-level headings are emphasised.
const INDENT_STEP = 16;
function OutlineRow({
  node,
  depth,
  rtl,
  colors,
  onPress,
}: {
  node: OutlineNodeDTO;
  depth: number;
  rtl: boolean;
  colors: ReturnType<typeof useThemeColors>;
  onPress: (index: number, title: string) => void;
}) {
  const isTop = depth === 0;
  const indent = depth * INDENT_STEP;
  return (
    <>
      <Pressable
        onPress={() => onPress(node.index, node.title)}
        style={[
          styles.row,
          {
            flexDirection: rtl ? "row-reverse" : "row",
            paddingLeft: rtl ? 0 : indent,
            paddingRight: rtl ? indent : 0,
          },
        ]}
      >
        <View
          style={[
            styles.bullet,
            {
              backgroundColor: isTop ? colors.brandPrimary : colors.textSecondary,
              width: isTop ? 7 : 5,
              height: isTop ? 7 : 5,
              borderRadius: isTop ? 3.5 : 2.5,
              opacity: isTop ? 1 : 0.55,
            },
          ]}
        />
        <Text
          style={[
            isTop ? styles.rowTitleTop : styles.rowTitle,
            { color: isTop ? colors.textPrimary : colors.textSecondary, textAlign: rtl ? "right" : "left" },
          ]}
          numberOfLines={2}
        >
          {node.title}
        </Text>
      </Pressable>
      {node.children.map((child) => (
        <OutlineRow key={child.index} node={child} depth={depth + 1} rtl={rtl} colors={colors} onPress={onPress} />
      ))}
    </>
  );
}

export function ThesisStructureSheet() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const thesis = useThesisStore((s) => s.getCurrentThesis());
  const isOpen = useBottomSheet((s) => s.openSheets.has("structure"));
  // Structure is derived from the live .docx (the source of truth), fetched on open.
  const [outline, setOutline] = useState<OutlineDTO | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["85%"], []);

  // Present on the NEXT frame, not synchronously inside the store-update commit:
  // this sheet opens while the composer tools tray is collapsing (Reanimated
  // layout animations), and a present() issued inside that busy commit gets
  // dropped by gorhom. One requestAnimationFrame lets the commit settle. Closing
  // is handled by unmounting (the `if (!isOpen) return null` below).
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => sheetRef.current?.present());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // Pull the heading outline from the working .docx whenever the sheet opens, so
  // it reflects the latest AI edits.
  useEffect(() => {
    if (!isOpen || !thesis) return;
    let active = true;
    getThesisOutline(thesis.id)
      .then((o) => { if (active) setOutline(o); })
      .catch(() => { if (active) setOutline(null); });
    return () => { active = false; };
  }, [isOpen, thesis?.id]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  // Mount the modal only while open, so every open is a FRESH instance that we
  // present() once on the next frame. An always-mounted BottomSheetModal silently
  // refuses to re-present after its first dismiss on the New Architecture.
  if (!isOpen) return null;

  const liveOutline = outline?.available ? outline : null;
  const nodes: OutlineNodeDTO[] = liveOutline ? liveOutline.nodes : [];
  const sectionCount = liveOutline ? liveOutline.sectionCount : 0;
  const chapterCount = liveOutline ? liveOutline.chapterCount : 0;
  // Direction follows the headings (Arabic theses are right-to-left).
  const rtl = nodes.length > 0 && isRtlText(nodes.map((n) => n.title).join(" "));

  // Tap any heading → open the live-docx workspace scrolled to that block.
  function handleHeadingPress(index: number, title: string) {
    if (!thesis) return;
    useBottomSheet.getState().closeSheet("structure");
    useWorkspaceStore.getState().setActivePanel(null);
    useWorkspaceStore.getState().selectBlock(index, title);
    router.push({
      pathname: "/(app)/thesis-workspace",
      params: { thesisId: thesis.id, blockIndex: String(index) },
    });
  }

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      enableDynamicSizing={false}
      onDismiss={() => {
        useBottomSheet.getState().closeSheet("structure");
        useWorkspaceStore.getState().setActivePanel(null);
      }}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.bgModal }}
      handleIndicatorStyle={{ backgroundColor: colors.textSecondary }}
    >
      {/* The scrollable is the DIRECT child of the modal — gorhom sizes it to the
          sheet and wires the scroll gesture. Header + counts scroll with the list. */}
      <BottomSheetScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>
          {t("thesis.thesisStructure")}
        </Text>

        <View style={[styles.statusRow, { flexDirection: rtl ? "row-reverse" : "row" }]}>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: colors.brandPrimary }]} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>{sectionCount} {t("home.sections")}</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: colors.brandAccent }]} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>{chapterCount} {t("home.chapters")}</Text>
          </View>
        </View>

        {nodes.length === 0 ? (
          <Text style={[styles.emptyText, { color: colors.textSecondary, textAlign: rtl ? "right" : "left" }]}>
            {t("thesis.noChapters", { defaultValue: "No headings found in this document yet." })}
          </Text>
        ) : (
          nodes.map((node) => (
            <OutlineRow key={node.index} node={node} depth={0} rtl={rtl} colors={colors} onPress={handleHeadingPress} />
          ))
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 12 },
  statusRow: { flexDirection: "row", gap: 16, marginBottom: 12 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { alignItems: "center", gap: 10, paddingVertical: 9 },
  bullet: { flexShrink: 0 },
  rowTitleTop: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 21 },
  rowTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", paddingVertical: 24 },
});
