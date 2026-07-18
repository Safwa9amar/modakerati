import { useEffect, useMemo, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  useReorderableDrag,
  reorderItems,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { GripVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { DocBlock } from "./DocBlock";
import {
  OutlineHeaderZone,
  OutlineFooterZone,
  OutlineSectionMarker,
  computeSectionMarkers,
} from "./OutlineChrome";
import { type DocBlockDTO, type DocSectionDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useThemeColors } from "@/hooks/useThemeColors";

// One outline row: a drag handle (long-press to lift) + the block. The handle
// owns the drag so DocBlock keeps its tap-to-select / long-press-multi-select.
// `markerLabel` renders a section marker ABOVE the row — chrome, not data, so
// it never enters the reorderable list's index space.
function Row({
  block,
  rtl,
  thesisId,
  version,
  markerLabel,
}: {
  block: DocBlockDTO;
  rtl: boolean;
  thesisId: string;
  version?: number;
  markerLabel?: string;
}) {
  const colors = useThemeColors();
  const drag = useReorderableDrag();
  return (
    <View>
      {markerLabel != null && <OutlineSectionMarker label={markerLabel} rtl={rtl} />}
      <View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
        <Pressable onLongPress={drag} delayLongPress={180} hitSlop={6} style={styles.handle}>
          <GripVertical size={18} color={colors.textPlaceholder} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} />
        </View>
      </View>
    </View>
  );
}

// The Outline view as a drag-to-reorder list. `blocks` is the server order (a
// block's `index` equals its position), so a drop's from/to map directly to
// engine indices. Optimistic reorder for a smooth drop; the doc store's op queue
// persists + flushes the move and re-syncs `blocks` (which renumbers indices).
// `sections` (optional — older caches lack it) adds READ-ONLY page chrome:
// header/footer zones as list header/footer, markers above section starts.
export function OutlineReorderable({
  thesisId,
  blocks,
  sections,
  rtl,
  paddingBottom,
  version,
}: {
  thesisId: string;
  blocks: DocBlockDTO[];
  sections?: DocSectionDTO[];
  rtl: boolean;
  paddingBottom: number;
  // Doc version → busts on-demand figure image caches after an edit.
  version?: number;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState(blocks);
  useEffect(() => setData(blocks), [blocks]);

  const markers = useMemo(() => computeSectionMarkers(t, sections), [t, sections]);

  // Stable elements (not inline component types) so the list header/footer
  // subtree doesn't remount on every render.
  const headerZone = useMemo(
    () =>
      sections?.[0]?.header ? (
        <View style={styles.bleedTop}>
          <OutlineHeaderZone section={sections[0]} rtl={rtl} />
        </View>
      ) : null,
    [sections, rtl],
  );
  const footerZone = useMemo(
    () =>
      sections?.[0]?.footer ? (
        <View style={styles.bleedBottom}>
          <OutlineFooterZone section={sections[0]} rtl={rtl} />
        </View>
      ) : null,
    [sections, rtl],
  );

  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    if (from === to) return;
    setData((cur) => reorderItems(cur, from, to));
    // Durable op: instant here (the local reorder above), persisted + flushed in
    // the background by the doc store, which also updates its own block model —
    // the `blocks` prop then re-syncs `data` via the effect above.
    void useThesisDocStore.getState().mutate(thesisId, { type: "move", from, to });
  };

  return (
    <ReorderableList
      data={data}
      onReorder={onReorder}
      keyExtractor={(b) => String(b.index)}
      renderItem={({ item }) => (
        <Row
          block={item}
          rtl={rtl}
          thesisId={thesisId}
          version={version}
          markerLabel={markers.get(item.index)}
        />
      )}
      ListHeaderComponent={headerZone}
      ListFooterComponent={footerZone}
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingBottom }]}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 6,
    // Clip the bleed zones' square grey corners to the card's rounding.
    overflow: "hidden",
  },
  content: { padding: 12 },
  row: { alignItems: "flex-start", gap: 2 },
  handle: { paddingTop: 12, paddingHorizontal: 2 },
  // Zones bleed to the card edges through the content's 12px padding.
  bleedTop: { marginHorizontal: -12, marginTop: -12, marginBottom: 10 },
  bleedBottom: { marginHorizontal: -12, marginBottom: -12, marginTop: 10 },
});
