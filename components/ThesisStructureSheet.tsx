import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import {
  BottomSheetModal,
  BottomSheetView,
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
import { getThesisOutline, type OutlineDTO, type OutlineSectionDTO } from "@/lib/api";

export function ThesisStructureSheet() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const router = useRouter();
  const thesis = useThesisStore((s) => s.getCurrentThesis());
  const isOpen = useBottomSheet((s) => s.openSheets.has("structure"));
  // Structure is derived from the live .docx (the source of truth), fetched on open.
  const [outline, setOutline] = useState<OutlineDTO | null>(null);
  const sheetRef = useRef<BottomSheetModal>(null);
  // gorhom wants a stable snapPoints reference; this component re-renders on
  // thesis-store changes, so memoize it to avoid handing the sheet a fresh array
  // mid-transition.
  const snapPoints = useMemo(() => ["80%"], []);

  // Present on the NEXT frame, not synchronously inside the store-update commit:
  // this sheet opens while the chat's tools tray is collapsing (Reanimated
  // layout animations), and a present() issued inside that busy commit gets
  // dropped by gorhom. One requestAnimationFrame lets the commit settle so
  // present() lands its mount→animate cleanly. Closing is handled by unmounting
  // (see the `if (!isOpen) return null` below), so no dismiss() call is needed.
  useEffect(() => {
    if (!isOpen) return;
    const id = requestAnimationFrame(() => sheetRef.current?.present());
    return () => cancelAnimationFrame(id);
  }, [isOpen]);

  // Pull the Partie/Chapitre outline from the working .docx whenever the sheet
  // opens, so it reflects the latest AI edits.
  useEffect(() => {
    if (!isOpen || !thesis) return;
    let active = true;
    getThesisOutline(thesis.id)
      .then((o) => { if (active) setOutline(o); })
      .catch(() => { if (active) setOutline(null); });
    return () => { active = false; };
  }, [isOpen, thesis?.id]);

  // Dim + tap-to-close backdrop, fading in once the sheet is on screen.
  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    []
  );

  // Mount the modal only while open, so every open is a FRESH instance that we
  // present() once on the next frame — the lifecycle AskBottomSheet uses. An
  // always-mounted BottomSheetModal silently refuses to re-present after its
  // first dismiss on the New Architecture, so reopen never worked. We gate on
  // isOpen (not `thesis`): opening with no thesis still shows an empty list.
  if (!isOpen) return null;

  const liveOutline = outline?.available ? outline : null;
  const sections: OutlineSectionDTO[] = liveOutline ? liveOutline.sections : [];
  const sectionCount = liveOutline ? liveOutline.sectionCount : 0;
  const chapterCount = liveOutline ? liveOutline.chapterCount : 0;

  // Tap a Partie → open the live-docx workspace scrolled to that heading block.
  function handleSectionPress(section: OutlineSectionDTO) {
    if (!thesis) return;
    useBottomSheet.getState().closeSheet("structure");
    useWorkspaceStore.getState().setActivePanel(null);
    useWorkspaceStore.getState().selectBlock(section.index, section.title);
    router.push({
      pathname: "/(app)/thesis-workspace",
      params: { thesisId: thesis.id, blockIndex: String(section.index) },
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
      <BottomSheetView style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("thesis.thesisStructure")}</Text>
        </View>

        {/* Counts summary (derived from the .docx) */}
        <View style={styles.statusRow}>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: colors.brandPrimary }]} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>{sectionCount} {t("home.sections")}</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={[styles.statusDot, { backgroundColor: colors.brandAccent }]} />
            <Text style={[styles.statusText, { color: colors.textSecondary }]}>{chapterCount} {t("home.chapters")}</Text>
          </View>
        </View>

        {/* Section list (tap → open the document at that heading) */}
        <BottomSheetScrollView
          style={styles.chapterList}
          contentContainerStyle={styles.chapterListContent}
          showsVerticalScrollIndicator={false}
        >
          {sections.map((section) => (
            <Pressable
              key={section.index}
              onPress={() => handleSectionPress(section)}
              style={[styles.chapterCard, { backgroundColor: colors.bgCard, borderColor: colors.navInactive + "40" }]}
            >
              <View style={styles.chapterRow}>
                <View style={styles.chapterLeft}>
                  <Text style={[styles.chapterTitle, { color: colors.textPrimary }]}>{section.title || t("thesis.thesisStructure")}</Text>
                </View>
              </View>
              {section.chapters.length > 0 && (
                <View style={styles.sectionsList}>
                  {section.chapters.map((ch) => (
                    <View key={ch.index} style={styles.sectionRow}>
                      <View style={[styles.sectionDot, { backgroundColor: colors.textSecondary }]} />
                      <Text style={[styles.sectionName, { color: colors.textSecondary }]}>{ch.title}</Text>
                    </View>
                  ))}
                </View>
              )}
            </Pressable>
          ))}
          <View style={{ height: 40 }} />
        </BottomSheetScrollView>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  addBtnText: { color: "#fff", fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", gap: 16, paddingHorizontal: 20, marginBottom: 16 },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  chapterList: { flex: 1 },
  chapterListContent: { paddingHorizontal: 20 },
  chapterCard: { borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1 },
  chapterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  chapterLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  dragHandle: { fontSize: 14 },
  chapterTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  sectionsList: { marginTop: 8, paddingLeft: 24 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionDot: { width: 4, height: 4, borderRadius: 2 },
  sectionName: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
