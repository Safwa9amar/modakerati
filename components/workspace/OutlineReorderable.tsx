import { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  useReorderableDrag,
  reorderItems,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { GripVertical } from "lucide-react-native";
import { DocBlock } from "./DocBlock";
import { type DocBlockDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useThemeColors } from "@/hooks/useThemeColors";

// One outline row: a drag handle (long-press to lift) + the block. The handle
// owns the drag so DocBlock keeps its tap-to-select / long-press-multi-select.
function Row({
  block,
  rtl,
  thesisId,
  version,
}: {
  block: DocBlockDTO;
  rtl: boolean;
  thesisId: string;
  version?: number;
}) {
  const colors = useThemeColors();
  const drag = useReorderableDrag();
  return (
    <View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
      <Pressable onLongPress={drag} delayLongPress={180} hitSlop={6} style={styles.handle}>
        <GripVertical size={18} color={colors.textPlaceholder} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} />
      </View>
    </View>
  );
}

// The Outline view as a drag-to-reorder list. `blocks` is the server order (a
// block's `index` equals its position), so a drop's from/to map directly to
// engine indices. Optimistic reorder for a smooth drop; the doc store's op queue
// persists + flushes the move and re-syncs `blocks` (which renumbers indices).
export function OutlineReorderable({
  thesisId,
  blocks,
  rtl,
  paddingBottom,
  version,
}: {
  thesisId: string;
  blocks: DocBlockDTO[];
  rtl: boolean;
  paddingBottom: number;
  // Doc version → busts on-demand figure image caches after an edit.
  version?: number;
}) {
  const [data, setData] = useState(blocks);
  useEffect(() => setData(blocks), [blocks]);

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
      renderItem={({ item }) => <Row block={item} rtl={rtl} thesisId={thesisId} version={version} />}
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingBottom }]}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#FFFFFF", marginHorizontal: 16, marginTop: 8, borderRadius: 6 },
  content: { padding: 12 },
  row: { alignItems: "flex-start", gap: 2 },
  handle: { paddingTop: 12, paddingHorizontal: 2 },
});
