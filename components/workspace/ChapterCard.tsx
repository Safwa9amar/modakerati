import React from "react";
import { Text, StyleSheet } from "react-native";
import { Markdown } from "@/components/Markdown";
import { getTextDirection } from "@/lib/text-direction";
import { PaperPage } from "./PaperPage";
import type { Chapter } from "@/types/thesis";

const INK = "#1A1A1A";
const MUTED = "#8A8A8A";

export function ChapterCard({ chapter, selected, onPress, emptyLabel }: { chapter: Chapter; selected?: boolean; onPress?: () => void; emptyLabel: string; }) {
  const dir = getTextDirection(chapter.title + " " + (chapter.content || ""));
  return (
    <PaperPage selected={selected} onPress={onPress}>
      <Text style={[styles.title, { color: INK, textAlign: dir === "rtl" ? "right" : "left", writingDirection: dir }]}>{chapter.title}</Text>
      {chapter.content?.trim()
        ? <Markdown content={chapter.content} color={INK} direction={dir} />
        : <Text style={[styles.empty, { color: MUTED, textAlign: dir === "rtl" ? "right" : "left" }]}>{emptyLabel}</Text>}
    </PaperPage>
  );
}
const styles = StyleSheet.create({
  title: { fontSize: 18, fontFamily: "Inter_700Bold", marginBottom: 10 },
  empty: { fontSize: 14, fontStyle: "italic", marginTop: 4 },
});
