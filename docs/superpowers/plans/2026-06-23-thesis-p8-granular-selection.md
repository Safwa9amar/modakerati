# Thesis P8 — Granular Block Selection in the Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Let the user tap **any block** of a chapter — a paragraph, a heading/title, a list, a table, or a chart — to select it, and aim the AI at exactly that block ("rewrite this paragraph", "make this title shorter", "change this chart to a pie"). Selection becomes a *focus* the AI applies within the chapter.

**Architecture (model A preserved):** A chapter's `content` stays one markdown string. The workspace tokenizes it into top-level **blocks** (via `marked` lexer; each token carries `.raw`), renders each block in its own tappable `SelectableBlock` (reusing the `Markdown` component on the block's raw text), and tracks `selectedBlock = { chapterId, index, text }`. The composer chip shows the block excerpt; the message carries the selected passage as `selection`. The server threads `selection` into the tool system prompt so the AI edits that passage and saves via `update_chapter_content`. No change to the data model — blocks are a *view/selection* concept, not stored rows.

**Tech Stack:** add `marked` to the app (same lib the server uses) for tokenization; `react-native-svg` charts (P7a); existing `Markdown`, stores, chat client.

**Branch:** `feat/thesis-hierarchy-p0`.

**Verified facts:**
- `components/workspace/ChapterCard.tsx`: renders `<PaperPage onPress={selectChapter}>` with chapter title + `<Markdown content={chapter.content} .../>`. `components/Markdown.tsx` exports `Markdown` (`{content, color?, direction?}`) and now renders ```chart``` blocks (P7a).
- `stores/thesis-store.ts`: `selected: { sectionId, chapterId }`, `selectChapter/selectSection/clearSelection`.
- `components/workspace/WorkspaceComposer.tsx`: reads `selected`, shows the chip, sends `sendMessageToAI(thesisId, text, { sectionId, chapterId })`.
- `lib/ai-service.ts`: `sendMessageToAI(thesisId, msg, opts?: { chapterId?, sectionId? })` → `runAssistantTurn` → `chatSendStream(..., { chapterId, sectionId, signal })`.
- `lib/api.ts`: `chatSend`/`chatSendStream` options `{ chapterId?, sectionId? }` → body.
- Server `routes/chat.ts`: reads `{ chapterId, sectionId }`, builds `focus`, passes to `streamChatWithTools(..., { focus })`. `buildToolSystemPrompt({ thesisId, focus })` injects the focus line.
- `react-native-marked` Renderer is used by `Markdown.tsx`; tokenization is NOT exposed → we add `marked` to tokenize.

---

## Task 1: App — block tokenizer

**Files:** add `marked` to the app; Create `lib/md-blocks.ts`

- [ ] **Step 1:** `cd /Users/hamzasafwan/modakerati && npm install marked` (same major as server — v18+; pure JS, RN-safe).
- [ ] **Step 2:** Create `lib/md-blocks.ts`:
```typescript
import { Lexer } from "marked";

export interface MdBlock { index: number; raw: string; type: string; excerpt: string; }

/** Top-level blocks of a chapter's markdown, each with its raw source + a short excerpt for the chip. */
export function chapterBlocks(md: string): MdBlock[] {
  const tokens = new Lexer().lex(md || "");
  const blocks: MdBlock[] = [];
  for (const t of tokens as any[]) {
    if (t.type === "space") continue;
    const raw = (t.raw ?? "").replace(/\n+$/, "");
    if (!raw.trim()) continue;
    let excerpt: string;
    if (t.type === "table") excerpt = "Tableau";
    else if (t.type === "code" && /^\s*```chart/i.test(t.raw)) excerpt = "Graphique";
    else excerpt = (t.text ?? raw).replace(/[#>*`\-]/g, "").trim().slice(0, 60);
    blocks.push({ index: blocks.length, raw: t.raw ?? raw, type: t.type, excerpt: excerpt || raw.slice(0, 60) });
  }
  return blocks;
}
```
- [ ] **Step 3:** tsc clean; commit:
```bash
git add package.json package-lock.json lib/md-blocks.ts
git commit -m "feat(app): marked + chapter block tokenizer for granular selection"
```

---

## Task 2: App — selection state

**Files:** Modify `stores/thesis-store.ts`

- [ ] **Step 1:** Extend `selected` to optionally carry a block:
```typescript
// in the state shape:
  selected: { sectionId: string | null; chapterId: string | null; blockIndex: number | null; blockText: string | null };
  selectBlock: (chapterId: string, blockIndex: number, blockText: string) => void;
```
Update the initial value to `{ sectionId: null, chapterId: null, blockIndex: null, blockText: null }`, and make `selectChapter`/`selectSection`/`clearSelection` reset `blockIndex`/`blockText` to null. Implement:
```typescript
  selectBlock: (chapterId, blockIndex, blockText) => set({ selected: { sectionId: null, chapterId, blockIndex, blockText } }),
```
(Existing `selectChapter` → `{ sectionId:null, chapterId, blockIndex:null, blockText:null }`; `selectSection` → `{ sectionId, chapterId:null, blockIndex:null, blockText:null }`.)
- [ ] **Step 2:** tsc clean (the WorkspaceComposer reads `selected.sectionId/chapterId` — still present; new fields are additive). Commit:
```bash
git add stores/thesis-store.ts && git commit -m "feat(app/store): block-level selection state"
```

---

## Task 3: App — selectable blocks in ChapterCard

**Files:** Modify `components/workspace/ChapterCard.tsx`

- [ ] **Step 1:** Rewrite `ChapterCard` to render the title as a selectable header + each content block as its own tappable row. Read the current file; keep `PaperPage` + INK/MUTED. New shape:
```typescript
import { chapterBlocks } from "@/lib/md-blocks";
import { useThesisStore } from "@/stores/thesis-store";
import { Pressable } from "react-native";
// ...
export function ChapterCard({ chapter, emptyLabel }: { chapter: Chapter; emptyLabel: string }) {
  const selected = useThesisStore((s) => s.selected);
  const blocks = useMemo(() => chapterBlocks(chapter.content || ""), [chapter.content]);
  const dirTitle = getTextDirection(chapter.title);
  return (
    <PaperPage>
      {/* Title = selectable (selects the whole chapter) */}
      <Pressable onPress={() => useThesisStore.getState().selectChapter(chapter.sectionId, chapter.id)}>
        <Text style={[styles.title, sel(selected, chapter, null) && styles.selOutline, { color: INK, textAlign: dirTitle === "rtl" ? "right" : "left" }]}>{chapter.title}</Text>
      </Pressable>
      {blocks.length === 0 ? (
        <Text style={[styles.empty, { color: MUTED }]}>{emptyLabel}</Text>
      ) : blocks.map((b) => {
        const dir = getTextDirection(b.raw);
        const isSel = selected.chapterId === chapter.id && selected.blockIndex === b.index;
        return (
          <Pressable key={b.index} onPress={() => useThesisStore.getState().selectBlock(chapter.id, b.index, b.raw)} style={[styles.block, isSel && styles.selBlock]}>
            <Markdown content={b.raw} color={INK} direction={dir} />
          </Pressable>
        );
      })}
    </PaperPage>
  );
}
```
Add a `sel(...)` helper for the title-selected case (chapter selected with no block), and styles: `block` (small vertical padding + a transparent left/right border), `selBlock` (e.g. `backgroundColor: "#EEF1FF", borderRadius: 6`), `selOutline` (a subtle highlight on the title). Use `useMemo` (import from react). Remove the old whole-card `onPress`/`selected` props usage (the workspace passes them — update the call site in Task 4). Keep `emptyLabel`.
- [ ] **Step 2:** tsc clean; commit (will compile once the workspace call site is updated in Task 4 — if tsc errors only on the ChapterCard props at the call site, that's expected; fix in Task 4 then verify clean):
```bash
git add components/workspace/ChapterCard.tsx && git commit -m "feat(app): selectable blocks (paragraph/title/table/chart) in ChapterCard"
```

---

## Task 4: App — workspace call site + composer chip + send selection

**Files:** Modify `app/(app)/thesis-workspace.tsx`, `components/workspace/WorkspaceComposer.tsx`, `lib/ai-service.ts`, `lib/api.ts`

- [ ] **Step 1:** `thesis-workspace.tsx`: update the `<ChapterCard>` usage to the new props (`chapter` + `emptyLabel` only; remove `selected`/`onPress`). The section divider still uses `selectSection`.
- [ ] **Step 2:** `lib/api.ts`: add `selection?: string` to both chat fns' options and include it in the body (`chatSend`, `chatSendStream`).
- [ ] **Step 3:** `lib/ai-service.ts`: extend `sendMessageToAI(thesisId, msg, opts?: { chapterId?; sectionId?; selection? })` and thread `selection` through `runAssistantTurn` → `chatSendStream`/`chatSend` options.
- [ ] **Step 4:** `WorkspaceComposer.tsx`: 
  - Chip label: if `selected.blockText` → `✎ {selected.blockText excerpt}` (truncate ~40 chars); else if `chapterId` → chapter title; else if `sectionId` → section title; else whole memoir. Show ✕ to clear (`clearSelection`).
  - On send, pass `selection: selected.blockText ?? undefined` alongside `sectionId`/`chapterId`: `sendMessageToAI(thesisId, text, { sectionId: selected.sectionId ?? undefined, chapterId: selected.chapterId ?? undefined, selection: selected.blockText ?? undefined })`.
- [ ] **Step 5:** tsc clean (only 8 pre-existing). Commit:
```bash
git add "app/(app)/thesis-workspace.tsx" components/workspace/WorkspaceComposer.tsx lib/ai-service.ts lib/api.ts
git commit -m "feat(app): workspace targets the selected block; composer chip + selection passthrough"
```

---

## Task 5: Server — selection-aware prompt

**Files:** Modify `src/routes/chat.ts`, `src/lib/ai/tool-loop.ts`, `src/lib/ai/types.ts`

- [ ] **Step 1:** `chat.ts` `/send` + `/stream`: read `selection` from the body; add it to the `focus` object (`focus.selection = typeof selection === "string" ? selection : undefined`).
- [ ] **Step 2:** `tool-loop.ts`: add `selection?: string` to the `focus` type in both opts.
- [ ] **Step 3:** `buildToolSystemPrompt`: when `focus.selection` is present, append:
```
\n- The student has SELECTED a specific passage of the focused chapter to work on:\n"""${focus.selection.slice(0, 800)}"""\nApply the requested change to THIS passage specifically (rewrite/expand/shorten/fix just it), then persist by reading the chapter (get_chapter_content), replacing only that passage, and calling update_chapter_content. Do not rewrite unrelated parts.
```
- [ ] **Step 4:** `npx tsc --noEmit` → 0. Commit:
```bash
git add src/routes/chat.ts src/lib/ai/tool-loop.ts src/lib/ai/types.ts
git commit -m "feat(server): selection-aware chat — edit the student's selected passage"
```

---

## Task 6: Verification
- [ ] **Step 1:** Server `npx tsc --noEmit` → 0. App `npx tsc --noEmit 2>&1 | grep error TS | grep -vE "global.css|absoluteFillObject|ProviderSelector"` → empty.
- [ ] **Step 2:** (Manual, user) In the workspace, tap a paragraph → it highlights + the chip shows its excerpt → "rewrite this more formally" → only that passage changes. Tap a chart block → "make it a pie chart" → the chart updates. Tap a heading → "shorten this title".

## Definition of done (P8)
- Chapter content renders as individually-tappable blocks (paragraph/title/list/table/chart); the tapped block highlights.
- The composer chip reflects the selected block; the AI receives the selected passage and edits just it.
- Both repos type-check (app: only pre-existing unrelated errors).

## Out of scope
- Sub-sentence / arbitrary text-range selection within a paragraph (RN text-range → markdown-offset mapping is hard) — block-level is the unit.
- Multi-block selection. Drag-to-reorder blocks (that's chapter content editing, not selection).
