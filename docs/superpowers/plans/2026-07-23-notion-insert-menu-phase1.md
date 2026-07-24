# Notion-style Insert Menu — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the slash/`+` Insert menu for the Lexical thesis editor with the "ready" blocks (Heading H1–H3, Quote, Bulleted, Numbered, Figure, Page break), the bubble→slash bloom motion, a compact recents menu, and a full-screen searchable menu — app-only, no server work.

**Architecture:** Slash detection lives inside the Lexical DOM editor (a new `SlashPlugin`, modeled on the existing `CompletionPlugin`) and reports out via a callback prop. A native React-Native overlay (`InsertMenu`) — driven by a new `insert-menu-store` — renders the menu, mirrors RTL/LTR, and blooms from the caret anchor. Picking a text block dispatches an `insert` command back into the editor (delete the `/query`, transform the block); structural blocks (Figure, Page break) flush the deletion then fire an existing native op via `thesis-doc-store.mutate`.

**Tech Stack:** Expo v56, React Native (New Arch), Lexical (Expo DOM component), Zustand, Reanimated, react-i18next (ar/fr/en), lucide-react-native, `useThemeColors`.

**Spec:** [docs/superpowers/specs/2026-07-23-notion-insert-menu-design.md](../specs/2026-07-23-notion-insert-menu-design.md)

**⚠️ No test runner:** The app has no jest/vitest. Every task is gated by `npx tsc --noEmit` (must be clean) plus the device-QA note in the final task. Commit after each task. Branch is `spike/lexical-bubble`; `git add` only the exact paths listed (parallel sessions share this tree — never `git add -A`, never `--amend`).

---

## File Structure

**Create:**
- `stores/insert-menu-store.ts` — menu open/mode/query/anchor/recents state + actions.
- `components/workspace/insert/insert-blocks.ts` — the categorized block palette config (single source of truth for kinds, icons, i18n keys, category, status).
- `components/workspace/insert/InsertMenu.tsx` — the RN overlay (compact + full-screen), bloom animation, pick handler.
- `lib/insert-image.ts` — shared `pickAndInsertImage(thesisId, afterIndex)` (extracted from BlockContextBar so there's one image-insert path).

**Modify:**
- `components/workspace/lexical/LexicalDomEditor.tsx` — add `SlashPlugin` + `INSERT_BLOCK_COMMAND` + `onInsertTrigger` prop; mount the plugin; add `case "insert"` to the EditorBridge command switch (`:392`).
- `components/workspace/WorkspaceLexicalView.tsx` — wire `onInsertTrigger` → `insert-menu-store`; pass the prop to `<LexicalDomEditor>` (`:609`); render `<InsertMenu>`.
- `components/workspace/GlobalDockBar.tsx` — add the `+` "Insert" chip (`:457` area).
- `components/workspace/BlockContextBar.tsx` — replace the inline `pickImage` body with a call to `pickAndInsertImage` (DRY).
- `locales/en.json`, `locales/fr.json`, `locales/ar.json` — add the `insertMenu` key block.

---

## Task 1: `insert-menu-store` (state + actions)

**Files:**
- Create: `stores/insert-menu-store.ts`

- [ ] **Step 1: Write the store**

```ts
import { create } from "zustand";

// The blocks the Insert menu can produce. Phase 1 wires the "ready" set; the
// Phase 2+ kinds are declared so the palette config and types are stable.
export type BlockKind =
  | "h1" | "h2" | "h3" | "quote" | "bullet" | "number" // text (Lexical transform)
  | "figure" | "pageBreak"                              // structural (native op)
  | "table" | "divider" | "equation" | "toc" | "footnote"; // Phase 2+

// Where the menu blooms: the block index (for placement) + screen Y of that line
// (already computed by WorkspaceLexicalView.onState as editorTop + s.y).
export interface InsertAnchor { index: number; y: number; }

interface InsertMenuState {
  open: boolean;
  mode: "compact" | "full";
  query: string;            // live filter: in compact this is the /query text; in full, the search field
  anchor: InsertAnchor | null;
  recents: BlockKind[];     // most-recent-first, deduped, session-scoped (persistence deferred)
  openAt: (anchor: InsertAnchor, opts?: { query?: string }) => void;
  setQuery: (q: string) => void;
  setAnchor: (a: InsertAnchor) => void;
  expand: () => void;       // compact → full
  collapse: () => void;     // full → compact
  close: () => void;
  pushRecent: (kind: BlockKind) => void;
}

const RECENTS_MAX = 4;

export const useInsertMenuStore = create<InsertMenuState>((set, get) => ({
  open: false,
  mode: "compact",
  query: "",
  anchor: null,
  recents: [],
  openAt: (anchor, opts) => set({ open: true, mode: "compact", anchor, query: opts?.query ?? "" }),
  setQuery: (q) => set({ query: q }),
  setAnchor: (a) => set({ anchor: a }),
  expand: () => set({ mode: "full" }),
  collapse: () => set({ mode: "compact" }),
  close: () => set({ open: false, mode: "compact", query: "" }),
  pushRecent: (kind) =>
    set((s) => ({ recents: [kind, ...s.recents.filter((k) => k !== kind)].slice(0, RECENTS_MAX) })),
}));
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (no errors referencing `insert-menu-store`).

- [ ] **Step 3: Commit**

```bash
git add stores/insert-menu-store.ts
git commit -m "feat(workspace/insert): insert-menu store (state + recents)"
```

---

## Task 2: i18n keys (en / fr / ar)

**Files:**
- Modify: `locales/en.json`, `locales/fr.json`, `locales/ar.json`

- [ ] **Step 1: Add the `insertMenu` block to `locales/en.json`** (as a new top-level key next to `"workspace"`)

```json
"insertMenu": {
  "title": "Insert into document",
  "searchPlaceholder": "Search blocks…",
  "recent": "Recently used",
  "aiSuggestions": "AI suggestions",
  "expandHint": "Drag up to search all tools",
  "comingSoon": "Coming soon",
  "cat": { "text": "Text", "lists": "Lists", "media": "Media & tables", "academic": "Academic", "layout": "Layout" },
  "block": {
    "h1": "Heading 1", "h2": "Heading 2", "h3": "Heading 3",
    "quote": "Quote", "bullet": "Bulleted list", "number": "Numbered list",
    "figure": "Figure / image", "pageBreak": "Page break",
    "table": "Table", "divider": "Divider", "equation": "Equation",
    "toc": "Table of contents", "footnote": "Footnote", "imageGen": "AI image generation"
  }
}
```

- [ ] **Step 2: Add the same block to `locales/fr.json`**

```json
"insertMenu": {
  "title": "Insérer dans le document",
  "searchPlaceholder": "Rechercher des blocs…",
  "recent": "Récemment utilisés",
  "aiSuggestions": "Suggestions IA",
  "expandHint": "Glissez vers le haut pour tout rechercher",
  "comingSoon": "Bientôt",
  "cat": { "text": "Texte", "lists": "Listes", "media": "Médias et tableaux", "academic": "Académique", "layout": "Mise en page" },
  "block": {
    "h1": "Titre 1", "h2": "Titre 2", "h3": "Titre 3",
    "quote": "Citation", "bullet": "Liste à puces", "number": "Liste numérotée",
    "figure": "Figure / image", "pageBreak": "Saut de page",
    "table": "Tableau", "divider": "Séparateur", "equation": "Équation",
    "toc": "Table des matières", "footnote": "Note de bas de page", "imageGen": "Génération d'image IA"
  }
}
```

- [ ] **Step 3: Add the same block to `locales/ar.json`**

```json
"insertMenu": {
  "title": "إدراج في المستند",
  "searchPlaceholder": "ابحث عن كتلة…",
  "recent": "مُستخدَم مؤخراً",
  "aiSuggestions": "اقتراحات الذكاء",
  "expandHint": "اسحب للأعلى للبحث في كل الأدوات",
  "comingSoon": "قريباً",
  "cat": { "text": "نص", "lists": "قوائم", "media": "وسائط وجداول", "academic": "عناصر أكاديمية", "layout": "تخطيط" },
  "block": {
    "h1": "عنوان رئيسي", "h2": "عنوان فرعي", "h3": "عنوان صغير",
    "quote": "اقتباس", "bullet": "قائمة نقطية", "number": "قائمة رقمية",
    "figure": "صورة / شكل", "pageBreak": "فاصل صفحة",
    "table": "جدول", "divider": "فاصل أفقي", "equation": "معادلة",
    "toc": "جدول المحتويات", "footnote": "حاشية سفلية", "imageGen": "توليد صورة بالذكاء الاصطناعي"
  }
}
```

- [ ] **Step 4: Validate JSON**

Run: `python3 -c "import json; [json.load(open(f'locales/{l}.json')) for l in ('en','fr','ar')]; print('ok')"`
Expected: `ok` (no JSON errors).

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(insert): insert-menu strings (en/fr/ar)"
```

---

## Task 3: Block palette config

**Files:**
- Create: `components/workspace/insert/insert-blocks.ts`

- [ ] **Step 1: Write the palette config** (single source of truth; ordered by category)

```ts
import type { LucideIcon } from "lucide-react-native";
import {
  Heading1, Heading2, Heading3, Quote, List, ListOrdered,
  Image as ImageIcon, SquareSplitVertical, Table, Minus, Sigma, ListTree, Superscript,
} from "lucide-react-native";
import type { BlockKind } from "@/stores/insert-menu-store";

export type InsertCategory = "text" | "lists" | "media" | "academic" | "layout";

export interface InsertBlockDef {
  kind: BlockKind;
  category: InsertCategory;
  Icon: LucideIcon;
  labelKey: string;        // → t(`insertMenu.block.${...}`)
  status: "ready" | "soon"; // Phase 1 wires "ready"; "soon" render disabled
}

// Order here is the render order inside each category.
export const INSERT_BLOCKS: InsertBlockDef[] = [
  { kind: "h1",       category: "text",     Icon: Heading1,            labelKey: "h1",       status: "ready" },
  { kind: "h2",       category: "text",     Icon: Heading2,            labelKey: "h2",       status: "ready" },
  { kind: "h3",       category: "text",     Icon: Heading3,            labelKey: "h3",       status: "ready" },
  { kind: "quote",    category: "text",     Icon: Quote,               labelKey: "quote",    status: "ready" },
  { kind: "bullet",   category: "lists",    Icon: List,                labelKey: "bullet",   status: "ready" },
  { kind: "number",   category: "lists",    Icon: ListOrdered,         labelKey: "number",   status: "ready" },
  { kind: "table",    category: "media",    Icon: Table,               labelKey: "table",    status: "soon" },  // Phase 2
  { kind: "figure",   category: "media",    Icon: ImageIcon,           labelKey: "figure",   status: "ready" },
  { kind: "divider",  category: "media",    Icon: Minus,               labelKey: "divider",  status: "soon" },  // Phase 2
  { kind: "equation", category: "academic", Icon: Sigma,               labelKey: "equation", status: "soon" },  // Phase 3
  { kind: "toc",      category: "academic", Icon: ListTree,            labelKey: "toc",      status: "soon" },  // Phase 3
  { kind: "footnote", category: "academic", Icon: Superscript,         labelKey: "footnote", status: "soon" },  // Phase 3
  { kind: "pageBreak",category: "layout",   Icon: SquareSplitVertical, labelKey: "pageBreak",status: "ready" },
];

export const INSERT_CATEGORIES: InsertCategory[] = ["text", "lists", "media", "academic", "layout"];

// Filter helper shared by compact (/query) and full-screen (search field). Matches
// the localized label OR the kind — caller passes the already-localized label getter.
export function filterBlocks(query: string, label: (def: InsertBlockDef) => string): InsertBlockDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return INSERT_BLOCKS;
  return INSERT_BLOCKS.filter((b) => b.kind.toLowerCase().includes(q) || label(b).toLowerCase().includes(q));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. If any lucide icon name is missing in this version, swap to the nearest existing icon (e.g. `Superscript` → `FileText`) — verify by importing from `lucide-react-native` in an existing file.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/insert/insert-blocks.ts
git commit -m "feat(workspace/insert): categorized block palette config"
```

---

## Task 4: `SlashPlugin` + `INSERT_BLOCK_COMMAND` + `case "insert"` in the editor

**Files:**
- Modify: `components/workspace/lexical/LexicalDomEditor.tsx` (add command near the other `createCommand`s; add `SlashPlugin` near `CompletionPlugin` ~`:932`; add `onInsertTrigger` to the props type ~`:1200s`; mount plugin ~`:1370`; add `case "insert"` at `:392`)

- [ ] **Step 1: Declare the command and the trigger payload** (top-level, near the existing custom commands)

```ts
import { createCommand, type LexicalCommand as LxCommand } from "lexical";

// Payload the native menu sends back in: which block to produce (or clearSlash =
// just remove the /query, used before a native structural op).
export type InsertBlockPayload = { kind: BlockKind | "clearSlash" };
export const INSERT_BLOCK_COMMAND: LxCommand<InsertBlockPayload> = createCommand("INSERT_BLOCK_COMMAND");
```

(`BlockKind` import: `import type { BlockKind } from "@/stores/insert-menu-store";`.)

- [ ] **Step 2: Write `SlashPlugin`** (place right after `CompletionPlugin`, ~`:922`)

```tsx
// Detects a "/command" typed at the caret and reports it to native (onInsertTrigger),
// mirroring CompletionPlugin's detect-and-report bridge. Owns INSERT_BLOCK_COMMAND:
// when native picks a block, this handler deletes the /query then transforms the
// current block (text kinds) or leaves an empty line (clearSlash, for native ops).
// A slash is a command only at block start or right after whitespace, query = the
// run of non-space, non-slash chars up to the caret.
const SLASH_RE = /(?:^|\s)\/([^\s/]*)$/;
function SlashPlugin({
  onInsertTrigger,
  suppressed,
}: {
  onInsertTrigger?: (t: { active: boolean; index: number; query: string }) => void;
  suppressed: boolean;
}) {
  const [editor] = useLexicalComposerContext();
  // Live slash location for deletion: the text node key + the offset of "/".
  const slashRef = useRef<{ nodeKey: string; start: number } | null>(null);

  // Detect + report.
  useEffect(() =>
    editor.registerUpdateListener(({ editorState, tags }) => {
      if (tags.has(SKIP_DOM_SELECTION_TAG)) return;
      let hit: { index: number; query: string; nodeKey: string; start: number } | null = null;
      editorState.read(() => {
        if (suppressed) return;
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) return;
        const node = sel.anchor.getNode();
        if (!$isTextNode(node)) return;
        const top = node.getTopLevelElement();
        if (!top || !($isParagraphNode(top) || $isHeadingNode(top))) return;
        const before = node.getTextContent().slice(0, sel.anchor.offset);
        const m = before.match(SLASH_RE);
        if (!m) return;
        const start = m.index! + (m[0].startsWith("/") ? 0 : 1); // offset of "/"
        hit = { index: $blockIndexOfNode(node), query: m[1], nodeKey: node.getKey(), start };
      });
      const chosen = hit as { index: number; query: string; nodeKey: string; start: number } | null;
      if (chosen) {
        slashRef.current = { nodeKey: chosen.nodeKey, start: chosen.start };
        onInsertTrigger?.({ active: true, index: chosen.index, query: chosen.query });
      } else if (slashRef.current) {
        slashRef.current = null;
        onInsertTrigger?.({ active: false, index: -1, query: "" });
      }
    }),
  [editor, onInsertTrigger, suppressed]);

  // Perform the insert when native picks a block.
  useEffect(() =>
    editor.registerCommand(
      INSERT_BLOCK_COMMAND,
      (payload) => {
        editor.update(() => {
          // 1) delete the /query run from the tracked text node
          const loc = slashRef.current;
          if (loc) {
            const n = $getNodeByKey(loc.nodeKey);
            if (n && $isTextNode(n)) {
              const end = Math.min(n.getTextContentSize(), (($getSelection() as any)?.anchor?.offset ?? n.getTextContentSize()));
              n.spliceText(loc.start, Math.max(0, end - loc.start), "", true);
            }
          }
          slashRef.current = null;
          if (payload.kind === "clearSlash") return; // native op will do the rest

          // 2) placement: transform current block if now empty, else split & apply after
          const sel = $getSelection();
          if (!$isRangeSelection(sel)) return;
          const top = sel.anchor.getNode().getTopLevelElement();
          const hasText = !!top && top.getTextContent().trim().length > 0;
          if (hasText && top) {
            const p = $createParagraphNode();
            top.insertAfter(p);
            p.select();
          }
          const s2 = $getSelection();
          if (!$isRangeSelection(s2)) return;
          switch (payload.kind) {
            case "h1": case "h2": case "h3":
              $setBlocksType(s2, () => $createHeadingNode(payload.kind as HeadingTagType));
              break;
            case "quote":
              $setBlocksType(s2, () => $createQuoteNode());
              break;
            case "bullet":
              $insertList("bullet");
              break;
            case "number":
              $insertList("number");
              break;
          }
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    ),
  [editor]);

  return null;
}
```

(If `$blockIndexOfNode` isn't already imported in this file, it is used by `CompletionPlugin` at `:994` — reuse the same import.)

- [ ] **Step 3: Add `onInsertTrigger` to the component props type + destructure it** (the big props object ending ~`:1336`)

```ts
  onInsertTrigger?: (t: { active: boolean; index: number; query: string }) => void;
```

- [ ] **Step 4: Mount `SlashPlugin`** (right after `<CompletionPlugin … />`, ~`:1377`)

```tsx
        <SlashPlugin onInsertTrigger={onInsertTrigger} suppressed={!!suggestion || !!rangeSuggestion || !!tableProposal} />
```

- [ ] **Step 5: Add `case "insert"` to the EditorBridge command switch** (after `case "serialize":`, `:457`)

```ts
      case "insert":
        // value = JSON { kind }. Delegate to SlashPlugin's command (owns the /query
        // deletion + placement). No focus() side-effect needed — the caret is live.
        if (command.value) editor.dispatchCommand(INSERT_BLOCK_COMMAND, JSON.parse(command.value) as InsertBlockPayload);
        break;
```

Also add `"insert"` to the no-focus guard list at `:391` so it behaves like `blockFormat` (don't re-pop the keyboard):

```ts
    if (command.type !== "blockFormat" && command.type !== "serialize" && command.type !== "list" && command.type !== "undo" && command.type !== "redo" && command.type !== "insert") editor.focus();
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add components/workspace/lexical/LexicalDomEditor.tsx
git commit -m "feat(workspace/lexical): SlashPlugin + INSERT_BLOCK_COMMAND + insert case"
```

---

## Task 5: Extract `pickAndInsertImage` (DRY the image insert)

**Files:**
- Create: `lib/insert-image.ts`
- Modify: `components/workspace/BlockContextBar.tsx` (the `pickImage` body, ~`:453-477`)

- [ ] **Step 1: Read the current `pickImage` implementation**

Run: `grep -n "pickImage" components/workspace/BlockContextBar.tsx`
Then read that function (≈`:453-477`) to copy its exact `ImagePicker` options and the `insertImage` op shape.

- [ ] **Step 2: Create `lib/insert-image.ts`** — move the body verbatim, parameterized by `afterIndex`

```ts
import * as ImagePicker from "expo-image-picker";
import { useThesisDocStore } from "@/stores/thesis-doc-store";

// Single image-insert path used by both the block bubble and the Insert menu.
// Opens the picker, reads base64, and fires the durable insertImage op after
// `afterIndex`. (Mirror the exact ImagePicker options that BlockContextBar used.)
export async function pickAndInsertImage(thesisId: string, afterIndex: number): Promise<void> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    base64: true,
    quality: 0.9,
  });
  if (res.canceled || !res.assets?.[0]?.base64) return;
  const asset = res.assets[0];
  await useThesisDocStore.getState().mutate(thesisId, {
    type: "insertImage",
    afterIndex,
    base64: asset.base64!,
    // keep any width/height/mime fields the original op used
  });
}
```

**Note:** match the `insertImage` op fields to `lib/thesis-ops.ts:70-77` exactly (add `mime`/`width`/`height` if present there). Verify with `grep -n "insertImage" lib/thesis-ops.ts`.

- [ ] **Step 3: Replace the `pickImage` body in `BlockContextBar.tsx`** to call the helper (keeps its own `afterIndex` computation)

```ts
import { pickAndInsertImage } from "@/lib/insert-image";
// …inside the component, replace the old body:
const pickImage = () => { void pickAndInsertImage(thesisId, /* existing afterIndex expr */); };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/insert-image.ts components/workspace/BlockContextBar.tsx
git commit -m "refactor(workspace): shared pickAndInsertImage helper"
```

---

## Task 6: `InsertMenu` component (compact + full-screen)

**Files:**
- Create: `components/workspace/insert/InsertMenu.tsx`

- [ ] **Step 1: Write the component.** It reads `insert-menu-store`, renders nothing when closed, blooms an animated card at the anchor (compact) or a full sheet (full), and routes picks. Direction from `i18n.dir()`. Colors from `useThemeColors`. Animation via Reanimated (mirror the spring feel in `2026-07-20-pill-motion-design.md`).

```tsx
import React, { useMemo } from "react";
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, useWindowDimensions } from "react-native";
import Animated, { useAnimatedStyle, withSpring, withTiming, FadeIn } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n"; // adjust to the app's i18n instance export
import { Sparkles, ImagePlus } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { useInsertMenuStore, type BlockKind } from "@/stores/insert-menu-store";
import { useLexicalEditorStore } from "@/stores/lexical-editor-store";
import { useThesisDocStore } from "@/stores/thesis-doc-store";
import { INSERT_BLOCKS, INSERT_CATEGORIES, filterBlocks, type InsertBlockDef } from "./insert-blocks";
import { pickAndInsertImage } from "@/lib/insert-image";

export function InsertMenu({ thesisId }: { thesisId: string }) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const open = useInsertMenuStore((s) => s.open);
  const mode = useInsertMenuStore((s) => s.mode);
  const query = useInsertMenuStore((s) => s.query);
  const anchor = useInsertMenuStore((s) => s.anchor);
  const recents = useInsertMenuStore((s) => s.recents);
  const rtl = i18n.dir() === "rtl";

  const label = (d: InsertBlockDef) => t(`insertMenu.block.${d.labelKey}`);
  const filtered = useMemo(() => filterBlocks(query, label), [query]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const pick = async (d: InsertBlockDef) => {
    if (d.status !== "ready") return;
    const a = useInsertMenuStore.getState().anchor;
    useInsertMenuStore.getState().pushRecent(d.kind);
    useInsertMenuStore.getState().close();
    const lex = useLexicalEditorStore.getState();
    if (["h1", "h2", "h3", "quote", "bullet", "number"].includes(d.kind)) {
      lex.dispatch("insert", JSON.stringify({ kind: d.kind }));           // text: transform in editor
      return;
    }
    // structural: delete the /query first (flush so the empty line persists), then native op
    lex.dispatch("insert", JSON.stringify({ kind: "clearSlash" }));
    await lex.flushEdits?.();
    if (!a) return;
    if (d.kind === "pageBreak") await useThesisDocStore.getState().mutate(thesisId, { type: "startOnNewPage", indices: [a.index] });
    else if (d.kind === "figure") await pickAndInsertImage(thesisId, a.index);
  };

  const Row = ({ d }: { d: InsertBlockDef }) => (
    <Pressable onPress={() => void pick(d)} disabled={d.status !== "ready"}
      style={({ pressed }) => [styles.row, { flexDirection: rtl ? "row-reverse" : "row", opacity: d.status !== "ready" ? 0.45 : pressed ? 0.6 : 1 }]}>
      <d.Icon size={18} color={colors.textSecondary} />
      <Text style={[styles.rowLabel, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]}>{label(d)}</Text>
      {d.status === "soon" ? <Text style={[styles.soon, { color: colors.textTertiary, backgroundColor: colors.bgSecondary }]}>{t("insertMenu.comingSoon")}</Text> : null}
    </Pressable>
  );

  const Cat = ({ c }: { c: (typeof INSERT_CATEGORIES)[number] }) => {
    const items = filtered.filter((b) => b.category === c);
    if (!items.length) return null;
    return (
      <View>
        <Text style={[styles.cat, { color: colors.textTertiary, borderTopColor: colors.borderSubtle, textAlign: rtl ? "right" : "left" }]}>{t(`insertMenu.cat.${c}`)}</Text>
        {items.map((d) => <Row key={d.kind} d={d} />)}
      </View>
    );
  };

  // Bloom origin = the caret line (anchor.y); clamp so it stays on screen.
  const top = Math.max(80, Math.min((anchor?.y ?? 200), 400));
  const bloom = useAnimatedStyle(() => ({ opacity: withTiming(1, { duration: 140 }), transform: [{ scale: withSpring(1, { damping: 16, stiffness: 220 }) }] }));

  return (
    <>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => useInsertMenuStore.getState().close()} />
      {mode === "full" ? (
        <Animated.View entering={FadeIn.duration(160)} style={[styles.sheet, { backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle }]}>
          <View style={styles.grab} />
          <Text style={[styles.title, { color: colors.textPrimary }]}>{t("insertMenu.title")}</Text>
          <View style={[styles.search, { backgroundColor: colors.bgSecondary, flexDirection: rtl ? "row-reverse" : "row" }]}>
            <TextInput autoFocus placeholder={t("insertMenu.searchPlaceholder")} placeholderTextColor={colors.textTertiary}
              value={query} onChangeText={(q) => useInsertMenuStore.getState().setQuery(q)}
              style={[styles.searchInput, { color: colors.textPrimary, textAlign: rtl ? "right" : "left" }]} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1 }}>
            {INSERT_CATEGORIES.map((c) => <Cat key={c} c={c} />)}
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.card, bloom, { top, backgroundColor: colors.bgPrimary, borderColor: colors.borderSubtle, transformOrigin: rtl ? "top right" : "top left" }]}>
          <Pressable style={styles.expand} onPress={() => useInsertMenuStore.getState().expand()}><Text style={{ color: colors.textTertiary }}>⤢</Text></Pressable>
          <View style={styles.grab} />
          {recents.length ? (
            <>
              <Text style={[styles.cat, styles.catFirst, { color: colors.textTertiary, textAlign: rtl ? "right" : "left" }]}>{t("insertMenu.recent")}</Text>
              {recents.map((k) => { const d = INSERT_BLOCKS.find((b) => b.kind === k); return d ? <Row key={k} d={d} /> : null; })}
            </>
          ) : (
            INSERT_CATEGORIES.map((c) => <Cat key={c} c={c} />)
          )}
          <View style={[styles.cat, { flexDirection: rtl ? "row-reverse" : "row", borderTopColor: colors.borderSubtle }]}>
            <Sparkles size={12} color={colors.brandPrimary} />
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>  {t("insertMenu.aiSuggestions")}</Text>
          </View>
          <View style={[styles.aiSoon, { borderColor: colors.borderSubtle, flexDirection: rtl ? "row-reverse" : "row" }]}>
            <ImagePlus size={16} color={colors.textTertiary} />
            <Text style={{ color: colors.textTertiary, flex: 1, textAlign: rtl ? "right" : "left" }}>  {t("insertMenu.block.imageGen")}</Text>
            <Text style={[styles.soon, { color: colors.textTertiary, backgroundColor: colors.bgSecondary }]}>{t("insertMenu.comingSoon")}</Text>
          </View>
          <Pressable onPress={() => useInsertMenuStore.getState().expand()} style={[styles.exHint, { borderTopColor: colors.borderSubtle }]}>
            <Text style={{ color: colors.textTertiary, fontSize: 11 }}>🔍 {t("insertMenu.expandHint")}</Text>
          </Pressable>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute", left: 12, right: 12, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, padding: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 14, zIndex: 50 },
  sheet: { position: "absolute", left: 0, right: 0, top: 40, bottom: 0, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 10, zIndex: 50 },
  grab: { width: 38, height: 4, borderRadius: 3, backgroundColor: "rgba(127,127,127,0.3)", alignSelf: "center", marginVertical: 6 },
  title: { fontSize: 13, fontFamily: "Inter_700Bold", textAlign: "center", paddingBottom: 8 },
  search: { alignItems: "center", borderRadius: 11, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", padding: 0 },
  cat: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5, paddingHorizontal: 8, paddingTop: 9, paddingBottom: 4, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 3, alignItems: "center", gap: 4 },
  catFirst: { borderTopWidth: 0, marginTop: 0 },
  row: { alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 9 },
  rowLabel: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  soon: { fontSize: 9, fontFamily: "Inter_700Bold", paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20, overflow: "hidden" },
  aiSoon: { alignItems: "center", gap: 8, padding: 10, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", margin: 2 },
  expand: { position: "absolute", top: 9, left: 12, zIndex: 1 },
  exHint: { alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 5 },
});
```

**Notes for the engineer:**
- `useThemeColors` prop names in this repo include `bgPrimary, bgSecondary, textPrimary, textSecondary, textTertiary, brandPrimary, borderSubtle, borderDefault`. If `textTertiary`/`borderSubtle` don't exist, use the closest (`textSecondary`/`borderDefault`) — verify against `hooks/useThemeColors.ts`.
- Confirm the app's i18n instance import path (some apps export from `@/lib/i18n`, others from `@/i18n`). `grep -rn "i18n.dir\|export default i18n" lib i18n src 2>/dev/null`.
- `transformOrigin` needs Reanimated ≥3.16 / RN 0.81+. If unsupported, drop it (the scale bloom still reads fine).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/workspace/insert/InsertMenu.tsx
git commit -m "feat(workspace/insert): InsertMenu overlay (compact + full-screen search)"
```

---

## Task 7: Wire the editor bridge → store, and render `InsertMenu`

**Files:**
- Modify: `components/workspace/WorkspaceLexicalView.tsx`

- [ ] **Step 1: Add the `onInsertTrigger` handler** (near `onState`, ~`:393`). It maps the editor's trigger to the store, using the same anchor Y the pill uses (`editorTopRef + s.y`). Because the trigger fires from an editor update (not `onState`), reuse the last known focus Y.

```ts
import { useInsertMenuStore } from "@/stores/insert-menu-store";
// …inside the component:
const onInsertTrigger = useCallback((tr: { active: boolean; index: number; query: string }) => {
  const store = useInsertMenuStore.getState();
  if (!tr.active) { if (store.open) store.close(); return; }
  const y = focusRef.current?.y != null ? editorTopRef.current + focusRef.current.y : 200;
  if (!store.open) store.openAt({ index: tr.index, y }, { query: tr.query });
  else { store.setAnchor({ index: tr.index, y }); store.setQuery(tr.query); }
}, []);
```

- [ ] **Step 2: Pass the prop to `<LexicalDomEditor>`** (in the props block ~`:609`)

```tsx
          onInsertTrigger={onInsertTrigger}
```

- [ ] **Step 3: Render `<InsertMenu>`** inside the container `<View>` (after `</View>` of `editorWrap`, before the container closes, ~`:646`)

```tsx
        <InsertMenu thesisId={thesisId} />
```

(Import: `import { InsertMenu } from "@/components/workspace/insert/InsertMenu";`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(workspace/insert): wire slash trigger + render InsertMenu"
```

---

## Task 8: Dock `+` Insert chip

**Files:**
- Modify: `components/workspace/GlobalDockBar.tsx`

- [ ] **Step 1: Import the store + a Plus icon** (top of file, with the other lucide imports)

```ts
import { Plus } from "lucide-react-native";
import { useInsertMenuStore } from "@/stores/insert-menu-store";
```

- [ ] **Step 2: Add an `openInsert` handler** (near `insertPageBreak`, ~`:210`). Anchors at the current selection's line if known, else a default Y.

```ts
const openInsert = () => {
  const idx = selectedBlocks.length ? selectedBlocks[0].index : editingBlockIndex ?? 0;
  const y = useFloatingPillStore.getState().anchorY ?? 200;
  useInsertMenuStore.getState().openAt({ index: idx, y });
};
```

- [ ] **Step 3: Add the chip** (in the chip row, right after the `pageBreak` chip, ~`:465`)

```tsx
            {chip({
              keyProp: "insert",
              Icon: Plus,
              accessibilityLabel: t("insertMenu.title", { defaultValue: "Insert" }),
              enterIndex: 10,
              onPress: openInsert,
            })}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/workspace/GlobalDockBar.tsx
git commit -m "feat(workspace/insert): dock + Insert chip opens the menu"
```

---

## Task 9: Device QA + final verification

**Files:** none (verification task).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: clean across the whole app.

- [ ] **Step 2: Launch the app** (per project convention — no test runner)

Run: `npx expo start` (or the project's usual dev command) and open the workspace on a device/simulator with a thesis that has content.

- [ ] **Step 3: QA checklist** — verify each on device, in **all three locales (ar/fr/en)** and both directions:

- Type `/` on an empty line → the ✦ menu blooms at that line; the compact card shows Recents (empty first run → falls back to categories) + the coming-soon AI image-gen chip.
- Typing `/head` filters the compact list live; deleting back to no `/` closes the menu.
- Tap **Heading 1/2/3** → current line becomes that heading, the `/query` is gone, keyboard stays.
- Tap **Quote / Bulleted / Numbered** → correct block type; `/query` gone.
- Tap **Page break** → the line's `startOnNewPage` flag applies (verify in Word/PDF preview); no leftover `/` text.
- Tap **Figure** → image picker opens; picked image inserts after the line; `/query` gone.
- Tap **⤢ / drag grabber** → expands to full-screen; the search field filters across all categories; `soon` blocks (Table/Divider/Equation/TOC/Footnote) render disabled.
- Dismiss: tap backdrop / delete the `/` → closes with no doc mutation.
- Dock **+** chip opens the compact menu anchored at the current block.
- RTL (ar): card grows from the top-right, rows right-aligned, icons mirrored side; LTR (en/fr): top-left.
- Undo after an insert reverts cleanly (Lexical history for text; op-queue undo for structural).
- Reduce Motion on: bloom still appears (no broken layout).

- [ ] **Step 4: Commit any QA fixes**, then update the spec status.

```bash
# after fixes:
git add -p   # stage only insert-menu-related hunks
git commit -m "fix(workspace/insert): device QA adjustments"
```

---

## Self-Review Notes (author)

- **Spec coverage:** entry points (slash + dock `+`) → Tasks 4/8; native-overlay architecture → Tasks 4–7; motion bloom → Task 6; compact recents + coming-soon → Task 6; full-screen search → Task 6; ready blocks → Tasks 4/5/6; placement rule (transform vs insert-after) → Task 4 Step 2; persistence dual-path (Lexical for text, mutate for structural) → Task 6 `pick`; i18n ar/fr/en + RTL → Tasks 2/6; dismissible → Task 6 backdrop/`onInsertTrigger` inactive.
- **Deferred to later phases (per spec):** Table create + N×M picker + Divider (Phase 2); Equation/TOC/Footnote server work (Phase 3); dynamic ✦ AI suggestion chips (Phase 4, only the disabled image-gen placeholder ships now). Recents persistence deferred (session-scoped in Phase 1).
- **Type consistency:** `BlockKind` (store) is the one kind union; `InsertBlockPayload.kind = BlockKind | "clearSlash"`; `onInsertTrigger` payload `{active,index,query}` identical in editor + view; `INSERT_BLOCK_COMMAND` used in Task 4 only.

---

## ⚠️ As-built note (2026-07-24)

This plan was executed (Tasks 1–8, subagent-driven), then the UI **pivoted** during device QA. Tasks 1–5 (store, i18n, palette, SlashPlugin/`INSERT_BLOCK_COMMAND`, image helper) still stand. **Tasks 6–8 were superseded:** the caret popover `InsertMenu.tsx` was deleted and replaced by a bottom push-drawer (`components/BottomInsertDrawer.tsx`) with the "F-B" tabs + colored-tile grid. Also added since: **H1–H6**, and a **Styles** category (Word paragraph `styleId`, app + `modakerati-server` `format` op). Correction to Task 4 Step 1: `INSERT_BLOCK_COMMAND` + `InsertBlockPayload` must be **file-local (no `export`)** — `LexicalDomEditor.tsx` is a `"use dom"` module (single default export only); the `export` version broke the iOS bundle and `tsc` doesn't catch it. See the spec's "As-built addendum" for the full picture.
