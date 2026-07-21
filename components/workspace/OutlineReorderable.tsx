import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, StyleSheet, type FlatList, type ScrollViewProps, type ViewToken } from "react-native";
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
const Row = memo(function Row({
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
  const rawDrag = useReorderableDrag();
  // Light tick on lift, then start the drag (the drop fires hMedium in onReorder).
  // Stable identity (useCallback) so the memoized DocBlock doesn't re-render merely
  // because this Row re-rendered.
  const drag = useCallback(() => {
    hLight();
    rawDrag();
  }, [rawDrag]);
  // Focus / typewriter mode: dim every block except the one being worked on.
  // Compute THIS block's dimmed flag INSIDE the selector and return a boolean, so a
  // change to the active block only re-renders the rows whose dimmed value actually
  // flips — not every visible row. (Subscribing to the global active index instead
  // re-rendered every visible row on each tap/edit — a big part of the edit-mode lag.)
  const dimmed = useWorkspaceStore((s) => {
    if (!s.focusMode) return false;
    const active =
      s.editingBlockIndex ?? (s.selectedBlocks.length === 1 ? s.selectedBlocks[0].index : null);
    return active != null && active !== block.index;
  });
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
  // A pending suggestion on an IMAGE block is a figure-caption action: unlike a
  // paragraph rewrite it does NOT replace the block — the figure stays visible and
  // the caption card renders BENEATH it. Presence-only gate (boolean primitive →
  // no zustand Object.is loop); the caption's "original" is the old caption, so
  // there's no text-match staleness gate as paragraphs have (drag is withheld
  // below while in review, keeping the index-keyed entry from desyncing).
  const imgSuggestion = useSuggestionStore(
    (s) => block.kind === "image" && !!s.byIndex[block.index],
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
          // Paragraph rewrite: the suggestion takes over the block's rendering
          // entirely (proposed text in doc typography + peek + pill). Drag/select
          // intentionally unavailable while the block is "in review".
          <InlineSuggestion thesisId={thesisId} block={block} rtl={rtl} />
        ) : imgSuggestion && block.kind === "image" ? (
          // Image caption: keep the figure visible and render the caption card
          // BELOW it (the student needs to see the figure the caption describes,
          // so we don't replace the block). Drag is withheld while in review so a
          // reorder can't renumber indices out from under the index-keyed entry.
          <>
            <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} />
            <InlineSuggestion thesisId={thesisId} block={block} rtl={rtl} />
          </>
        ) : (
          <DocBlock block={block} rtl={rtl} thesisId={thesisId} version={version} onLongPressDrag={drag} />
        )}
      </Animated.View>
    </View>
  );
});

// The Outline view as a drag-to-reorder list. `blocks` is the server order (a
// block's `index` equals its position), so a drop's from/to map directly to
// engine indices. Optimistic reorder for a smooth drop; the doc store's op queue
// persists + flushes the move and re-syncs `blocks` (which renumbers indices).
// `sections` (optional — older caches lack it) adds READ-ONLY page chrome:
// header/footer zones as list header/footer, markers above section starts.
function OutlineReorderableInner({
  thesisId,
  blocks,
  sections,
  rtl,
  paddingBottom,
  version,
  scrollTarget,
  onScroll,
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
  // Scroll passthrough for the workspace's auto-hiding header. Safe to pass a
  // Reanimated handler: react-native-reorderable-list composes it with its own
  // internal scroll worklet (useComposedEventHandler in ReorderableListCore).
  onScroll?: ScrollViewProps["onScroll"];
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

  // Stable renderItem so a re-render of this list (e.g. a marker/version change)
  // doesn't hand every cell a brand-new closure and force all visible rows to
  // reconcile. Each Row is memoized and re-renders only on its own store slices.
  const renderItem = useCallback(
    ({ item }: { item: DocBlockDTO }) => (
      <Row
        block={item}
        rtl={rtl}
        thesisId={thesisId}
        version={version}
        markerLabel={markers.get(item.index)}
      />
    ),
    [rtl, thesisId, version, markers],
  );

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
      renderItem={renderItem}
      ListHeaderComponent={headerZone}
      ListFooterComponent={footerZone}
      style={styles.list}
      contentContainerStyle={[styles.content, { paddingBottom }]}
      showsVerticalScrollIndicator={false}
      // NOTE: react-native-reorderable-list omits `scrollEventThrottle` from its
      // props (it hardcodes its own internal throttle) and composes this handler
      // with its own scroll worklet via useComposedEventHandler.
      onScroll={onScroll}
      // Keep the keyboard up when tapping straight from one editing block to
      // another (or onto a toolbar button); a tap on empty space dismisses it.
      keyboardShouldPersistTaps="handled"
    />
  );
}

// Memoized so a selection tap (which no longer touches this component's props) or
// any unrelated workspace re-render can't reconcile the whole list.
export const OutlineReorderable = memo(OutlineReorderableInner);

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
