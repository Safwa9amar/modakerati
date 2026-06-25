# Thesis P7 — Figures & Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Let theses include **charts** (bar/pie/line — survey results for the *partie pratique*), authored by the AI from the student's data/sources or hand-edited, kept as **data** (not pictures) so they stay editable and re-themeable. Render them in the live workspace, the A4 preview, and (P7b) the exported `.docx`.

**Architecture (model A preserved):** A chart is a fenced ```chart``` block of JSON inside chapter markdown: `{ type, title?, labels[], values[] }`. A single dependency-free pure function `chartToSvg(spec) → svgString` (duplicated in app + server — ~identical) renders it. The app `Markdown` renderer detects the block → `SvgXml` (react-native-svg). The server `preview-html` pre-processes the block → inline `<svg>`. The AI is told it can emit chart blocks. **P7b** (separate, gated on a dependency decision) embeds the SVG (rasterized to PNG) into the `.docx` via a new mdocxengine drawing-run helper — the same unlock as figure-image embedding.

**Tech Stack:** `react-native-svg` `SvgXml` (app, already installed); `marked` lexer/renderer; a hand-rolled SVG generator (no new deps for P7a).

**Branch:** `feat/thesis-hierarchy-p0`.

**Chart spec (v1, single series):**
```json
{ "type": "bar" | "line" | "pie", "title": "optional", "labels": ["A","B"], "values": [10, 20] }
```

---

## P7a — charts in app + preview + AI (no new deps)

### Task 1: Shared `chartToSvg`

**Files:** Create `lib/chart-svg.ts` (app) AND `src/lib/chart-svg.ts` (server) — identical pure function. Test: `scripts/test-chart-svg.ts` (server).

- [ ] **Step 1:** Implement `chartToSvg` (pure, no deps). It returns a self-contained `<svg>...</svg>` string for bar/pie/line. Use a fixed viewBox (e.g. 0 0 480 300), a small palette, axis/labels for bar/line, slices+legend for pie, the title at top. Keep it deterministic (no random). Signature:
```typescript
export interface ChartSpec { type: "bar" | "line" | "pie"; title?: string; labels: string[]; values: number[]; }
export function chartToSvg(spec: ChartSpec, opts?: { width?: number; height?: number; rtl?: boolean }): string;
```
Implementation notes: clamp/guard (labels.length === values.length, non-negative for pie, handle empty → a placeholder svg with the title). Bars: scale to max value, draw `<rect>` per bar + value labels + x labels. Pie: cumulative angles → `<path>` arc slices + a legend. Line: polyline through scaled points + dots. Escape title text. A ~150-line function; write it fully (no placeholders). Provide the SAME file content in both repos (adjust nothing repo-specific — it's pure TS).
- [ ] **Step 2:** Server test `scripts/test-chart-svg.ts`: `chartToSvg({type:"bar",title:"T",labels:["a","b"],values:[3,7]})` → assert it starts with `<svg`, contains `T`, contains two `<rect`; pie → contains `<path`; line → contains `<polyline` or `<path`; empty values → still returns `<svg`. Run → PASS.
- [ ] **Step 3:** Commit (server): `git add src/lib/chart-svg.ts scripts/test-chart-svg.ts && git commit -m "feat(server): chartToSvg (dependency-free bar/pie/line SVG)"`. Commit (app): `git add lib/chart-svg.ts && git commit -m "feat(app): chartToSvg (shared chart renderer)"`.

### Task 2: Workspace renders chart blocks

**Files:** Modify `components/Markdown.tsx`

- [ ] **Step 1:** In `components/Markdown.tsx`, the renderer is `class EmojiRenderer extends Renderer`. Override the `code` method to special-case the `chart` language:
```typescript
import { SvgXml } from "react-native-svg";
import { chartToSvg, type ChartSpec } from "@/lib/chart-svg";
// inside EmojiRenderer:
code(text: string, language?: string, containerStyle?: any) {
  if ((language || "").toLowerCase() === "chart") {
    try {
      const spec = JSON.parse(text) as ChartSpec;
      const svg = chartToSvg(spec, { width: 320, height: 200 });
      return <SvgXml key={this.getKey()} xml={svg} width="100%" />;
    } catch {/* fall through to default code rendering */}
  }
  return super.code(text, language, containerStyle);
}
```
(Confirm react-native-marked's `Renderer.code` signature — adjust arg names/return to match the installed version; the key behavior is: language `chart` → parse JSON → `SvgXml`.)
- [ ] **Step 2:** Manual/visual is the real check, but ensure `npx tsc --noEmit` stays clean (only the 8 pre-existing). Commit:
```bash
git add components/Markdown.tsx && git commit -m "feat(app): render ```chart blocks as SVG charts in the workspace"
```

### Task 3: A4 preview renders chart blocks

**Files:** Modify `src/lib/preview-html.ts`

- [ ] **Step 1:** Before `marked.parse(content)`, pre-process the markdown to replace ```chart fenced blocks with an inline SVG so they don't render as code. Add a helper:
```typescript
import { chartToSvg, type ChartSpec } from "./chart-svg";
function renderChartBlocks(md: string, rtl: boolean): string {
  return (md || "").replace(/```chart\s*([\s\S]*?)```/g, (_m, body) => {
    try { const spec = JSON.parse(body) as ChartSpec; return `\n<div class="figure">${chartToSvg(spec, { width: 520, height: 320, rtl })}</div>\n`; }
    catch { return ""; }
  });
}
```
Apply `renderChartBlocks(ch.content, rtl)` (and section content) BEFORE `mdToHtml(...)`. Add `.figure{margin:14px 0;text-align:center;} .figure svg{max-width:100%;height:auto;}` to the preview CSS. (Note: `marked` passes raw HTML through by default; if it escapes it, set `marked.parse(md, { async:false })` — HTML blocks are preserved by GFM. If the inline SVG gets escaped, instead split the markdown around chart blocks, `mdToHtml` the text parts, and concatenate with the SVG — implement whichever preserves the SVG.)
- [ ] **Step 2:** Extend `scripts/test-preview-html.ts` (or a new assertion): a chapter whose content includes a ```chart block → the produced HTML contains `<svg`. Run → PASS. tsc clean. Commit:
```bash
git add src/lib/preview-html.ts scripts/test-preview-html.ts && git commit -m "feat(server): render chart blocks as SVG in A4 preview"
```

### Task 4: AI authors charts

**Files:** Modify `src/lib/ai/types.ts` (`buildToolSystemPrompt`)

- [ ] **Step 1:** Add a bullet:
```
- To present quantitative results (survey data, statistics) as a CHART, embed a fenced code block with language "chart" inside the chapter content, containing JSON: {"type":"bar|line|pie","title":"…","labels":["…"],"values":[…]}. Generate charts from the student's data or from an attached source material. The app renders these as real charts.
```
- [ ] **Step 2:** tsc clean. Commit:
```bash
git add src/lib/ai/types.ts && git commit -m "feat(server): prompt the AI to author charts as ```chart blocks"
```

### P7a verification
- [ ] Server `npx tsc --noEmit` → 0; `npx tsx scripts/test-chart-svg.ts` + `test-preview-html.ts` PASS.
- [ ] App `npx tsc --noEmit` → only the 8 pre-existing errors.
- [ ] (Manual) ask the AI in the workspace to "make a bar chart of [data]" → a chart renders in the chapter card; ⤢ A4 preview shows the chart.

**P7a done:** charts authored as data, rendered live + in the A4 preview. In the exported `.docx` a chart still appears as its fenced text until P7b. Note that limitation in the export (a `[Chart: <title>]` line is acceptable interim — optionally strip the chart block from docx and emit a caption placeholder).

---

## P7b — embed charts & figures in the `.docx` (GATED on a dependency decision)

> Do NOT start P7b until the user approves the dependency. This is the same pipeline that finishes the P1.x figure-image embedding.

**Decision needed:** to put a chart/figure into Word you need a raster image. Options:
- **`@resvg/resvg-js`** (recommended) — prebuilt SVG→PNG, no system libs, fast. New server dep.
- `sharp` — heavier (librsvg), broader native footprint.
- Pre-render charts to PNG client-side and upload — avoids a server dep but only covers charts the app rendered.

**Work once approved:**
1. Server dep + `svgToPng(svg) → Buffer`.
2. **mdocxengine drawing-run helper** — build the `<w:drawing>`/`<wp:inline>` run XML referencing the `relId` from `MediaManager.insertImage`, and add it to a `Paragraph` via the run API (the missing public piece). Factor as `insertImageParagraph(engine, pngBuffer, { widthPx, heightPx, caption? })`.
3. `docx.ts`: in the chapter walk, detect ```chart blocks → `chartToSvg` → `svgToPng` → `insertImageParagraph` (with an auto-numbered caption "Figure N: title"). Same path embeds uploaded figure images (closes P1.x).
4. Golden-file test: exported `.docx` contains a `word/media/imageN.png` + a drawing reference.

---

## Definition of done
- **P7a:** chart blocks render in the workspace + A4 preview; the AI authors them; no new deps; both repos type-check.
- **P7b (after approval):** charts + figures embed as real images in the exported `.docx`.

## Out of scope
- Multi-series charts, axis customization, chart theming beyond a default palette (v1 is single-series bar/pie/line).
- Editing a chart via a GUI (charts are edited by changing the JSON or asking the AI).
