import { useEffect, useState } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import ReorderableList, {
  useReorderableDrag,
  reorderItems,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { GripVertical } from "lucide-react-native";
import { DocBlock } from "./DocBlock";
import { moveThesisBlock, type DocBlockDTO } from "@/lib/api";
import { useThemeColors } from "@/hooks/useThemeColors";

// One outline row: a drag handle (long-press to lift) + the block. The handle
// owns the drag so DocBlock keeps its tap-to-select / long-press-multi-select.
function Row({ block, rtl }: { block: DocBlockDTO; rtl: boolean }) {
  const colors = useThemeColors();
  const drag = useReorderableDrag();
  return (
    <View style={[styles.row, { flexDirection: rtl ? "row-reverse" : "row" }]}>
      <Pressable onLongPress={drag} delayLongPress={180} hitSlop={6} style={styles.handle}>
        <GripVertical size={18} color={colors.textPlaceholder} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <DocBlock block={block} rtl={rtl} />
      </View>
    </View>
  );
}

// The Outline view as a drag-to-reorder list. `blocks` is the server order (a
// block's `index` equals its position), so a drop's from/to map directly to
// engine indices. Optimistic reorder for a smooth drop; onAfterMove re-syncs from
// the server (which renumbers indices).
export function OutlineReorderable({
  thesisId,
  blocks,
  rtl,
  onAfterMove,
  paddingBottom,
}: {
  thesisId: string;
  blocks: DocBlockDTO[];
  rtl: boolean;
  onAfterMove: () => void;
  paddingBottom: number;
}) {
  const [data, setData] = useState(blocks);
  useEffect(() => setData(blocks), [blocks]);

  const onReorder = ({ from, to }: ReorderableListReorderEvent) => {
    if (from === to) return;
    setData((cur) => reorderItems(cur, from, to));
    void moveThesisBlock(thesisId, from, to)
      .catch(() => {})
      .finally(onAfterMove);
  };

  return (
    <ReorderableList
      data={data}
      onReorder={onReorder}
      keyExtractor={(b) => String(b.index)}
      renderItem={({ item }) => <Row block={item} rtl={rtl} />}
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
