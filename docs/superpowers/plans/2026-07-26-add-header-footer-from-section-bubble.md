# Add header / footer from the section bubble — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student add a running header and/or footer to a section that has none, straight from the section-marker (`§`) bubble in the Lexical writer.

**Architecture:** The section bubble (`hfSection` toolset in `BlockContextBar`) gains a `Plus` chip that opens an `hfAdd` sub-pill offering "Add header" / "Add footer" — shown only for the parts the section lacks. Each handler calls the **existing** `/chrome-op` (`setHeaderText` / `setFooter`), which creates the part server-side; the echoed document re-renders the band via `buildChrome`, and an optimistic `setChromeSelection` lands the student on the new band's tools. No new server code or endpoint.

**Tech Stack:** React Native (Expo v56), Zustand stores, trilingual i18n (en/fr/ar), Hono/Drizzle server (unchanged), mdocxengine (unchanged).

**⚠️ Verification model:** The Expo app has **no JS test runner** (see memory `app-verification-no-test-runner`). Do **not** write jest tests. Gate each task with `npx tsc --noEmit` (run from `/Users/hamzasafwan/modakerati`) and the manual device-QA checklist in Task 4. Server is untouched, so no server tests are needed.

**Design spec:** `docs/superpowers/specs/2026-07-26-add-header-footer-from-section-bubble-design.md`

---

## File structure

- `stores/workspace-store.ts` — add `hasHeader?`/`hasFooter?` to `ChromeSelection`.
- `components/workspace/WorkspaceLexicalView.tsx` — set `hasHeader`/`hasFooter` in `onState`'s chrome branch.
- `components/workspace/BlockContextBar.tsx` — mirror the two fields on the `chrome` prop; add the `hfAdd` category, the `Plus` chip, the sub-pill, and the `addHeader`/`addFooter` handlers.
- `locales/{en,fr,ar}.json` — three new `workspace.hf` keys (surgical edits).

No files are created. All work is additive.

---

## Task 1: Plumb `hasHeader` / `hasFooter` through the selection

Adds the two flags the "Add" chip needs — sourced from the same inheritance-resolved `sections` that `buildChrome` uses, so "Add" appears exactly when no band renders.

**Files:**
- Modify: `stores/workspace-store.ts:7-19`
- Modify: `components/workspace/BlockContextBar.tsx:206-218`
- Modify: `components/workspace/WorkspaceLexicalView.tsx:540-555`

- [ ] **Step 1: Add the fields to `ChromeSelection`**

In `stores/workspace-store.ts`, extend the `ChromeSelection` type. Replace:

```ts
  // Top band only: the header's tab/cell-positioned segments, so the Edit-text input
  // shows the parts separated (like the docx) rather than concatenated.
  segments?: string[];
};
```

with:

```ts
  // Top band only: the header's tab/cell-positioned segments, so the Edit-text input
  // shows the parts separated (like the docx) rather than concatenated.
  segments?: string[];
  // Section band only: whether the section already renders a header / footer band
  // (own or inherited). Drives the "Add header/footer" affordance — shown only for
  // the parts that are missing. Read from the same resolved sections buildChrome uses.
  hasHeader?: boolean;
  hasFooter?: boolean;
};
```

- [ ] **Step 2: Mirror the fields on the `BlockContextBar` `chrome` prop**

In `components/workspace/BlockContextBar.tsx`, in the `chrome?: {...}` prop type (around line 206-218), replace:

```ts
    // Top band only: the header's positioned segments — Edit-text pre-fills with these
    // (tab-joined) so the parts show separated instead of concatenated.
    segments?: string[];
  } | null;
```

with:

```ts
    // Top band only: the header's positioned segments — Edit-text pre-fills with these
    // (tab-joined) so the parts show separated instead of concatenated.
    segments?: string[];
    // Section band only: whether the section already renders a header / footer band —
    // gates the "Add header/footer" sub-pill options.
    hasHeader?: boolean;
    hasFooter?: boolean;
  } | null;
```

- [ ] **Step 3: Set the fields in `onState`'s chrome branch**

In `components/workspace/WorkspaceLexicalView.tsx`, the chrome branch already resolves the containing `sec`. Find the `ws.setChromeSelection({ ... })` call (around line 555) and replace:

```ts
      ws.setChromeSelection({ kind, index: s.index, text, pageNumbers, linkedToPrevious, startsOnNewPage, segments });
```

with:

```ts
      // Section band only: does this section already show a header / footer band?
      // Mirrors buildChrome's `if (s.header)` / `if (s.footer)` so "Add" appears only
      // when a part is genuinely missing (an inherited header counts as present).
      const hasHeader = kind === "section" ? !!sec?.header : undefined;
      const hasFooter = kind === "section" ? !!sec?.footer : undefined;
      ws.setChromeSelection({ kind, index: s.index, text, pageNumbers, linkedToPrevious, startsOnNewPage, segments, hasHeader, hasFooter });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors. (`chrome={chromeSelection}` already flows the new fields into `BlockContextBar`.)

- [ ] **Step 5: Commit**

```bash
git add stores/workspace-store.ts components/workspace/BlockContextBar.tsx components/workspace/WorkspaceLexicalView.tsx
git commit -m "feat(chrome): report section hasHeader/hasFooter to the bubble"
```

---

## Task 2: Add the trilingual i18n keys

Three keys under `workspace.hf`, added **surgically** — never `JSON.parse`/`dump` these files (they contain duplicate keys; see memory `locale-json-duplicate-keys`). Anchor each edit on that file's `"newSectionHere"` line.

**Files:**
- Modify: `locales/en.json:648`
- Modify: `locales/fr.json:648`
- Modify: `locales/ar.json:648`

- [ ] **Step 1: English**

In `locales/en.json`, replace:

```json
      "newSectionHere": "New section starts here",
```

with:

```json
      "newSectionHere": "New section starts here",
      "addHeaderFooter": "Add header / footer",
      "addHeader": "Add header",
      "addFooter": "Add footer",
```

- [ ] **Step 2: French**

In `locales/fr.json`, replace:

```json
      "newSectionHere": "Nouvelle section ici",
```

with:

```json
      "newSectionHere": "Nouvelle section ici",
      "addHeaderFooter": "Ajouter en-tête / pied de page",
      "addHeader": "Ajouter un en-tête",
      "addFooter": "Ajouter un pied de page",
```

- [ ] **Step 3: Arabic**

In `locales/ar.json`, replace:

```json
      "newSectionHere": "يبدأ قسم جديد هنا",
```

with:

```json
      "newSectionHere": "يبدأ قسم جديد هنا",
      "addHeaderFooter": "إضافة رأس / تذييل",
      "addHeader": "إضافة رأس الصفحة",
      "addFooter": "إضافة تذييل الصفحة",
```

- [ ] **Step 4: Verify the JSON still parses (all three files)**

Run: `node -e "for (const f of ['en','fr','ar']) { JSON.parse(require('fs').readFileSync('locales/'+f+'.json','utf8')); console.log(f, 'ok'); }"`
Expected: `en ok` / `fr ok` / `ar ok`. (This only reads/validates — it does not rewrite the files.)

- [ ] **Step 5: Commit**

```bash
git add locales/en.json locales/fr.json locales/ar.json
git commit -m "i18n(chrome): add header/footer strings for the section bubble"
```

---

## Task 3: The "Add" chip, the `hfAdd` sub-pill, and the handlers

Wires the UI. `Plus` is already imported; `chip`, `optPill`, `styles.optText`, `applyChrome`, `setActiveCategory`, and `useWorkspaceStore` are all already in scope in this file.

**Files:**
- Modify: `components/workspace/BlockContextBar.tsx:90` (Category union)
- Modify: `components/workspace/BlockContextBar.tsx:808` (handlers)
- Modify: `components/workspace/BlockContextBar.tsx:940-978` (section chip row)
- Modify: `components/workspace/BlockContextBar.tsx:1084` (sub-pill non-chrome guard)
- Modify: `components/workspace/BlockContextBar.tsx:1111` (sub-pill body)

- [ ] **Step 1: Add `"hfAdd"` to the `Category` union**

Replace (line 90):

```ts
type Category = "style" | "align" | "direction" | "list" | "color" | "tblRows" | "tblCols" | "tblLayout" | "tblShade" | "tblBorders" | "hfAI" | "hfLink";
```

with:

```ts
type Category = "style" | "align" | "direction" | "list" | "color" | "tblRows" | "tblCols" | "tblLayout" | "tblShade" | "tblBorders" | "hfAI" | "hfLink" | "hfAdd";
```

- [ ] **Step 2: Add the `addHeader` / `addFooter` handlers**

Immediately after the `startOnNewPage` handler (which ends around line 808, right before the `// ── Prev/Next section navigation` comment), insert:

```ts
  // Give a section that has NO header/footer band a fresh one, straight from the
  // section bubble. `setHeaderText`/`setFooter` create the part server-side even from
  // empty; the echoed doc re-renders the band via buildChrome. We optimistically
  // select the new band so its tools appear at once — and because its kind becomes
  // top/bottom, the existing "auto-open ✦ on a header/footer band" effect opens the
  // ✦ panel, landing the student directly in "then edit".
  const addHeader = () => {
    if (!chrome || chrome.kind !== "section") return;
    applyChrome({ op: "setHeaderText", index: chrome.index, text: "" });
    useWorkspaceStore.getState().setChromeSelection({ kind: "top", index: chrome.index, text: "" });
    setActiveCategory(null);
  };
  const addFooter = () => {
    if (!chrome || chrome.kind !== "section") return;
    // A new footer defaults to centered page numbers — the most common real footer.
    applyChrome({ op: "setFooter", index: chrome.index, text: "", pageNumbers: true, alignment: "center" });
    useWorkspaceStore.getState().setChromeSelection({ kind: "bottom", index: chrome.index, text: "", pageNumbers: true });
    setActiveCategory(null);
  };
```

- [ ] **Step 3: Add the `Plus` chip as the first section-band chip, and bump the others' `enterIndex`**

In the `chrome?.kind === "section"` branch of `chromeTools` (the `<>...</>` fragment around lines 940-979), insert the Add chip as the **first** child, then increment each existing chip's `enterIndex` by 1. Replace:

```tsx
      <>
        {chrome.linkedToPrevious != null
          ? chip({
              keyProp: "hf-link",
              Icon: Link2,
              accessibilityLabel: t("workspace.hf.linkToggle", { defaultValue: "Link to previous section" }),
              active: activeCategory === "hfLink",
              enterIndex: 0,
              onPress: () => setActiveCategory((cur) => (cur === "hfLink" ? null : "hfLink")),
            })
          : null}
        {chip({
          keyProp: "hf-prev-sec",
          Icon: ChevronUp,
          accessibilityLabel: t("workspace.hf.prevSection", { defaultValue: "Previous section" }),
          active: false,
          disabled: !hasPrevSection,
          enterIndex: 1,
          onPress: () => goToSection(-1),
        })}
        {chip({
          keyProp: "hf-next-sec",
          Icon: ChevronDown,
          accessibilityLabel: t("workspace.hf.nextSection", { defaultValue: "Next section" }),
          active: false,
          disabled: !hasNextSection,
          enterIndex: 2,
          onPress: () => goToSection(1),
        })}
        {!chrome.startsOnNewPage
          ? chip({
              keyProp: "hf-newpage",
              Icon: SeparatorHorizontal,
              accessibilityLabel: t("workspace.hf.startOnNewPage", { defaultValue: "Start on a new page" }),
              active: false,
              enterIndex: 3,
              onPress: startOnNewPage,
            })
          : null}
      </>
```

with:

```tsx
      <>
        {!chrome.hasHeader || !chrome.hasFooter
          ? chip({
              keyProp: "hf-add",
              Icon: Plus,
              accessibilityLabel: t("workspace.hf.addHeaderFooter", { defaultValue: "Add header / footer" }),
              active: activeCategory === "hfAdd",
              enterIndex: 0,
              onPress: () => setActiveCategory((cur) => (cur === "hfAdd" ? null : "hfAdd")),
            })
          : null}
        {chrome.linkedToPrevious != null
          ? chip({
              keyProp: "hf-link",
              Icon: Link2,
              accessibilityLabel: t("workspace.hf.linkToggle", { defaultValue: "Link to previous section" }),
              active: activeCategory === "hfLink",
              enterIndex: 1,
              onPress: () => setActiveCategory((cur) => (cur === "hfLink" ? null : "hfLink")),
            })
          : null}
        {chip({
          keyProp: "hf-prev-sec",
          Icon: ChevronUp,
          accessibilityLabel: t("workspace.hf.prevSection", { defaultValue: "Previous section" }),
          active: false,
          disabled: !hasPrevSection,
          enterIndex: 2,
          onPress: () => goToSection(-1),
        })}
        {chip({
          keyProp: "hf-next-sec",
          Icon: ChevronDown,
          accessibilityLabel: t("workspace.hf.nextSection", { defaultValue: "Next section" }),
          active: false,
          disabled: !hasNextSection,
          enterIndex: 3,
          onPress: () => goToSection(1),
        })}
        {!chrome.startsOnNewPage
          ? chip({
              keyProp: "hf-newpage",
              Icon: SeparatorHorizontal,
              accessibilityLabel: t("workspace.hf.startOnNewPage", { defaultValue: "Start on a new page" }),
              active: false,
              enterIndex: 4,
              onPress: startOnNewPage,
            })
          : null}
      </>
```

- [ ] **Step 4: Add `hfAdd` to the sub-pill non-chrome guard**

Replace (line 1084):

```ts
    if ((activeCategory === "hfAI" || activeCategory === "hfLink") && !isChrome) return null;
```

with:

```ts
    if ((activeCategory === "hfAI" || activeCategory === "hfLink" || activeCategory === "hfAdd") && !isChrome) return null;
```

- [ ] **Step 5: Render the `hfAdd` sub-pill body**

Find the sub-pill body dispatch that begins `if (activeCategory === "hfLink") {` (around line 1111) and insert an `hfAdd` branch **before** it. Replace:

```tsx
    if (activeCategory === "hfLink") {
```

with:

```tsx
    if (activeCategory === "hfAdd") {
      // Add-a-part sub-pill: plain-language actions, only for the parts the section
      // lacks. Each creates the band (setHeaderText / setFooter) and selects it.
      const addOpt = (key: string, label: string, enterIndex: number, onPress: () => void) => (
        <AnimatedChip
          key={key}
          enterIndex={enterIndex}
          onPress={onPress}
          accessibilityLabel={label}
          style={optPill(false)}
        >
          <Text numberOfLines={1} style={[styles.optText, { color: colors.textPrimary }]}>
            {label}
          </Text>
        </AnimatedChip>
      );
      body = (
        <>
          {!chrome?.hasHeader ? addOpt("add-hdr", t("workspace.hf.addHeader", { defaultValue: "Add header" }), 0, addHeader) : null}
          {!chrome?.hasFooter ? addOpt("add-ftr", t("workspace.hf.addFooter", { defaultValue: "Add footer" }), 1, addFooter) : null}
        </>
      );
    } else if (activeCategory === "hfLink") {
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add components/workspace/BlockContextBar.tsx
git commit -m "feat(chrome): add header/footer to a section from the section bubble"
```

---

## Task 4: Device QA + finalize

No automated tests exist for this surface — verify on a device/simulator running the app.

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 2: Manual QA — happy path (section that lacks a header AND footer)**

  1. Open a thesis in the writer with document-structure indicators ON (bands visible).
  2. Find a section **after the first** whose header/footer bands are absent, and tap its `§ New section starts here` marker.
  3. Confirm the bubble now shows a **`+` (Add)** chip first. Tapping it opens a sub-pill with **Add header** and **Add footer**.
  4. Tap **Add header** → an empty header band (`—`) appears at the section top, is selected, and its ✦ panel opens. Confirm `✦ Ask` drafts/apply works on it.
  5. Re-tap the same `§` marker → the sub-pill now offers only **Add footer** (header no longer missing).
  6. Tap **Add footer** → a footer band showing **centered page numbers** appears, selected, ✦ panel open.
  7. Re-tap the `§` marker → the **`+` Add chip is gone** (both parts now present).

- [ ] **Step 3: Manual QA — inherited-header case**

On a section that **inherits** a header from the previous section (a top band already renders for it), tap its `§` marker → the sub-pill offers **only Add footer** (Add header suppressed because `hasHeader` is true).

- [ ] **Step 4: Manual QA — trilingual + RTL**

Switch app language to Arabic. Repeat Step 2 on an RTL thesis; confirm the Add chip, the sub-pill labels (`إضافة رأس الصفحة` / `إضافة تذييل الصفحة`), and the resulting bands read correctly right-to-left.

- [ ] **Step 5: Mark the plan complete**

Tick every checkbox above and note any device-QA deviations inline in this file.

---

## Self-review notes

- **Spec coverage:** enrichment (Task 1) ↔ spec §1; chip + sub-pill (Task 3 steps 3-5) ↔ spec §2; handlers (Task 3 step 2) ↔ spec §3; i18n (Task 2) ↔ spec §4. First-section non-goal is honored (no code path targets section 0). ✅
- **No new types dangling:** `hasHeader`/`hasFooter` are defined in Task 1 (store + prop) before use in Task 3. Handler op payloads (`setHeaderText`, `setFooter`) match the existing `ChromeOp` union in `lib/api.ts`. ✅
- **Naming consistency:** `hfAdd` category, `hf-add` chip key, `addHeader`/`addFooter` handlers, `addOpt` renderer — used identically across steps. ✅
- **Auto-open ✦:** selecting the new `top`/`bottom` band triggers the existing effect (`BlockContextBar` ~line 371) that sets `activeCategory = "hfAI"`. This is intended (the "then edit" landing), not a regression — the handlers' `setActiveCategory(null)` is superseded by that effect on the next render.
