import { useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, type FlatList, type ViewToken } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import ReorderableList, {
  useReorderableDrag,
  reorderItems,
  type ReorderableListReorderEvent,
} from "react-native-reorderable-list";
import { useTranslation } from "react-i18next";
import { DocBlock } from "./DocBlock";
import { InlineSuggestion } from "./InlineSuggestion";
import {
  OutlineHeaderZone,
  OutlineFooterZone,
  OutlineSectionMarker,
  computeSectionMarkers,
} from "./OutlineChrome";
import { type DocBlockDTO, type DocSectionDTO } from "@/lib/api";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSuggestionStore } from "@/stores/suggestion-store";
import { hLight, hMedium } from "@/lib/haptics";

// One outline row: a drag handle (long-press to lift) + the block. The handle
// owns the drag so DocBlock keeps its tap-to-select / long-press-multi-select.
// `markerLabel` renders a section marker ABOVE the row — chrome, not data, so
// it never enters the reorderable list's index space.
function Row({
  block,
  blocks,
  rtl,
  thesisId,
  version,
  markerLabel,
}: {
  block: DocBlockDTO;
  // Full block model — the inline toolbar pill needs it (paragraph props + count).
  blocks: DocBlockDTO[];
  rtl: boolean;
  thesisId: string;
  version?: number;
  markerLabel?: string;
}) {
  const rawDrag = useReorderableDrag();
  // Light tick on lift, then start the drag (the drop fires hMedium in onReorder).
  const drag = () => {
    hLight();
    rawDrag();
  };
  // Focus / typewriter mode: dim every block except the one being worked on.
  // Select primitives individually (store convention — an object/array literal
  // selector would loop). The "active" block is the inline-edited one, else the
  // sole selected block; when nothing is active, no block is dimmed.
  const focusMode = useWorkspaceStore((s) => s.focusMode);
  const activeIndex = useWorkspaceStore((s) =>
    s.editingBlockIndex ?? (s.selectedBlocks.length === 1 ? s.selectedBlocks[0].index : null),
  );
  const dimmed = focusMode && activeIndex != null && activeIndex !== block.index;
  // A pending inline AI suggestion on THIS block REPLACES the block's own
  // rendering (in-place proposal + its own controls) and suppresses the pill.
  // STALENESS GATE: the suggestion only counts if its stored `original` still
  // matches this paragraph's current text — suggestions are keyed by BARE
  // index, so a structural edit elsewhere (split/merge/delete/reorder) that
  // renumbers indices, or an AI tool rewriting the paragraph mid-suggestion,
  // would otherwise overlay (and let Approve overwrite) the WRONG paragraph.
  // A mismatched entry simply stops rendering; the workspace-exit clear()
  // sweeps it away. Boolean-primitive selector → no zustand Object.is loop.
  const hasSuggestion = useSuggestionStore(
    (s) => block.kind === "paragraph" && s.byIndex[block.index]?.original === block.text,
  );

  // Post-navigation flash: when the jump lands on THIS block, pulse a brand tint so
  // the eye finds the heading. Selector returns the nonce only for the target block
  // (else null) → a primitive, re-fires the pulse on each navigation.
  const flashNonce = useWorkspaceStore((s) =>
    s.flashTarget && s.flashTarget.index === block.index ? s.flashTarget.nonce : null,
  );
  const flash = useSharedValue(0);
  useEffect(() => {
    if (flashNonce == null) return;
    flash.value = withSequence(withTiming(1, { duration: 160 }), withTiming(0, { duration: 780 }));
  }, [flashNonce]);
  const flashStyle = useAnimatedStyle(() => ({
    backgroundColor: `rgba(92,107,255,${flash.value * 0.16})`,
    borderRadius: 8,
  }));

  return (
    <View>
      {markerLabel != null && <OutlineSectionMarker label={markerLabel} rtl={rtl} />}
      <Animated.View style={[styles.row, dimmed && styles.dimmed, flashStyle]}>
        {/* kind narrowing: hasSuggestion is only ever true for paragraphs. */}
        {hasSuggestion && block.kind === "paragraph" ? (
          // The suggestion takes over the block's rendering entirely (proposed
          // text in doc typography + peek + pill). Drag/select intentionally
          // unavailable while the block is "in review".
          <InlineSuggestion thesisId={thesisId} block={block} rtl={rtl} />
        ) : (
          <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} onLongPressDrag={drag} />
        )}
      </Animated.View>
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
  scrollTarget,
}: {
  thesisId: string;
  blocks: DocBlockDTO[];
  sections?: DocSectionDTO[];
  rtl: boolean;
  paddingBottom: number;
  // Doc version → busts on-demand figure image caches after an edit.
  version?: number;
  // Pending "scroll to this block" request from the outline navigator (nonce
  // bumps per request so the same heading re-scrolls).
  scrollTarget?: { index: number; nonce: number } | null;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState(blocks);
  useEffect(() => setData(blocks), [blocks]);

  // ReorderableList forwards its ref to the underlying FlatList → scrollToIndex.
  const listRef = useRef<FlatList<DocBlockDTO>>(null);

  // Bring the requested block into view. `scrollTarget.index` is an engine block
  // index; the list position can differ, so resolve it against the current data.
  // Runs on nonce change (and on mount, catching a request set before navigation).
  useEffect(() => {
    if (!scrollTarget) return;
    const pos = data.findIndex((b) => b.index === scrollTarget.index);
    if (pos < 0) return;
    // Defer a frame so a just-mounted list is laid out before we scroll. Jump
    // INSTANTLY (animated:false) — the workspace's NavOverlay masks the doc while
    // it moves, so an animated fly-through would only be seen as jank.
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: pos, animated: false, viewPosition: 0 });
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollTarget?.nonce]);

  // Report the top-most visible block so the Structure drawer can highlight the
  // heading the reader is currently under ("you are here"). Stable refs — React
  // forbids changing onViewableItemsChanged / viewabilityConfig on the fly.
  const onViewableChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const top = viewableItems[0]?.item as DocBlockDTO | undefined;
    if (top) useWorkspaceStore.getState().setActiveBlockIndex(top.index);
  });
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 1 });

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
    hMedium();
    setData((cur) => reorderItems(cur, from, to));
    // Durable op: instant here (the local reorder above), persisted + flushed in
    // the background by the doc store, which also updates its own block model —
    // the `blocks` prop then re-syncs `data` via the effect above.
    void useThesisDocStore.getState().mutate(thesisId, { type: "move", from, to });
  };

  return (
    <ReorderableList
      ref={listRef}
      data={data}
      onReorder={onReorder}
      keyExtractor={(b) => String(b.index)}
      // Rows have variable, unmeasured heights → scrollToIndex can miss before the
      // target is laid out. Jump to an estimated offset, then correct once settled.
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
        setTimeout(() => {
          listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
        }, 120);
      }}
      onViewableItemsChanged={onViewableChanged.current}
      viewabilityConfig={viewabilityConfig.current}
      renderItem={({ item }) => (
        <Row
          block={item}
          blocks={blocks}
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
      // Keep the keyboard up when tapping straight from one editing block to
      // another (or onto a toolbar button); a tap on empty space dismisses it.
      keyboardShouldPersistTaps="handled"
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    // Edge-to-edge paper — no dark side gutters around the editor.
    marginHorizontal: 0,
    marginTop: 8,
    borderRadius: 6,
    // Clip the bleed zones' square grey corners to the card's rounding.
    overflow: "hidden",
  },
  content: { padding: 12 },
  // Block occupies the full row now that the drag grip is gone (long-press the
  // block itself to lift it for reorder).
  row: {},
  // Focus-mode dim for non-active blocks (pure styling; no data change).
  dimmed: { opacity: 0.35 },
  // Zones bleed to the card edges through the content's 12px padding.
  bleedTop: { marginHorizontal: -12, marginTop: -12, marginBottom: 10 },
  bleedBottom: { marginHorizontal: -12, marginBottom: -12, marginTop: 10 },
});
