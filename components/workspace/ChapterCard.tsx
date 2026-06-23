import React, { useMemo } from "react";
import { Text, Pressable, StyleSheet } from "react-native";
import { Markdown } from "@/components/Markdown";
import { getTextDirection } from "@/lib/text-direction";
import { chapterBlocks } from "@/lib/md-blocks";
import { useThesisStore } from "@/stores/thesis-store";
import { PaperPage } from "./PaperPage";
import { useThemeColors } from "@/hooks/useThemeColors";
import type { Chapter } from "@/types/thesis";

const INK = "#1A1A1A";
const MUTED = "#8A8A8A";

export function ChapterCard({ chapter, emptyLabel }: { chapter: Chapter; emptyLabel: string }) {
  const colors = useThemeColors();
  const selected = useThesisStore((s) => s.selected);
  const blocks = useMemo(() => chapterBlocks(chapter.content || ""), [chapter.content]);
  const titleDir = getTextDirection(chapter.title);
  const titleSelected = selected.chapterId === chapter.id && selected.blockIndex === null;
  const hi = colors.brandPrimary;

  return (
    <PaperPage>
      <Pressable onPress={() => useThesisStore.getState().selectChapter(chapter.sectionId, chapter.id)}>
        <Text
          style={[
            styles.title,
            { color: INK, textAlign: titleDir === "rtl" ? "right" : "left", writingDirection: titleDir },
            titleSelected && { backgroundColor: hi + "22", borderRadius: 6 },
          ]}
        >
          {chapter.title}
        </Text>
      </Pressable>
      {blocks.length === 0 ? (
        <Text style={[styles.empty, { color: MUTED }]}>{emptyLabel}</Text>
      ) : (
        blocks.map((b) => {
          const dir = getTextDirection(b.raw);
          const isSel = selected.chapterId === chapter.id && selected.blockIndex === b.index;
          return (
            <Pressable
              key={b.index}
              onPress={() => useThesisStore.getState().selectBlock(chapter.id, b.index, b.raw)}
              style={[styles.block, isSel && { backgroundColor: hi + "18", borderColor: hi }]}
            >
              <Markdown content={b.raw} color={INK} direction={dir} />
            </Pressable>
          );
        })
      )}
    </PaperPage>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10, paddingHorizontal: 4, paddingVertical: 2 },
  empty: { fontSize: 14, fontStyle: "italic", marginTop: 4 },
  block: { borderRadius: 6, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 6, paddingVertical: 2, marginVertical: 1 },
});
