# Thesis P6 — Source Materials (Helper Files + RAG Tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Let the student attach reference files to a thesis — each with a **title** and a **description of what to take from it** — which the AI reads on demand (via MCP tools) when drafting. Upload + list + delete from the workspace; the AI uses `list_sources`/`get_source_content`.

**Architecture:** New `thesis_sources` table (mirrors `documents` + `thesisId` FK + `description` + `extractedText`). `POST /api/thesis/:id/sources` decodes base64, extracts plain text (`.docx` via the existing mdocxengine path, `.txt`/`.md` directly), stores the file in a `sources` bucket + a row with the extracted text. MCP tools `list_sources(thesisId)` (titles + descriptions) and `get_source_content(sourceId)` (extracted text) let the AI pull material; `buildToolSystemPrompt` is told they exist. App: a "Sources" sheet (list + inline add form: pick file → title → description) reachable from the workspace top bar.

**Tech Stack:** Hono + Drizzle + mdocxengine (server); Expo `DocumentPicker`/`FileSystem` + Zustand + gorhom BottomSheet (app).

**Branch:** `feat/thesis-hierarchy-p0`.

**Verified facts:**
- `document-service.ts`: `loadEngine(buffer)` → engine; `engine.document.getParagraphs()` → `Paragraph[]`; `await p.getPlainTextSafe()` → `{ text }`. `decodeBase64(base64)` (handles data-URI prefix). `MAX_BYTES` = 10 MB. Import is `.docx`-only.
- `document-storage.ts`: `ensureBucket(name)` + `supabaseAdmin.storage.from(bucket).upload(path, buffer, { contentType, upsert: true })`; bucket via env, path `${userId}/${id}.docx`.
- `schema.ts` `documents` table shape; `ensureSchema()` in `db/index.ts` creates tables with `CREATE TABLE IF NOT EXISTS` (documents block at lines ~63-77).
- `mcp/server.ts`: `asText(data)` helper; `userOwnsThesis(thesisId, userId)`; tools via `server.tool(name, desc, zodSchema, handler)`.
- `routes/documents.ts` `POST /import` `{ base64, filename, language }` → `importDocument`. Routes mounted in `src/index.ts`.
- App `stores/document-store.ts` `importDocx()`: `DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory })` → `FileSystem.readAsStringAsync(uri, { encoding: Base64 })` → `importDocument(base64, name)` api. `lib/api.ts` `apiPost`, `importDocument`.
- `stores/bottom-sheet-store.ts`: `SheetName = "structure" | "ask" | "new-thesis"`. `components/BottomSheet.tsx` conditional-unmount pattern.
- Workspace top bar (`app/(app)/thesis-workspace.tsx`) — has room for a Sources button next to ⤢.
- `buildToolSystemPrompt` (server `lib/ai/types.ts`) — lists the thesis tools; add sources tools here.
- No PDF lib present → P6 supports `.docx` + `.txt`/`.md`; PDF/images deferred (accepted+stored, extraction empty + flagged).

---

## Task 1: Server — schema + extraction helper + storage

**Files:** Modify `src/db/schema.ts`, `src/db/index.ts`; Create `src/lib/source-service.ts`

- [ ] **Step 1:** `schema.ts` — add `thesisSources` (after `documents`):
```typescript
export const thesisSources = pgTable("thesis_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").default(""),
  filename: text("filename").notNull(),
  fileType: text("file_type").default("docx"), // docx | txt | md | pdf | image | other
  storagePath: text("storage_path").default(""),
  extractedText: text("extracted_text").default(""),
  status: text("status").default("ready"), // ready | unextracted
  sizeBytes: integer("size_bytes").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```
- [ ] **Step 2:** `ensureSchema()` — add the CREATE TABLE IF NOT EXISTS (mirror documents) + index:
```sql
    CREATE TABLE IF NOT EXISTS thesis_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      thesis_id uuid NOT NULL REFERENCES theses (id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
      title text NOT NULL,
      description text DEFAULT '',
      filename text NOT NULL,
      file_type text DEFAULT 'docx',
      storage_path text DEFAULT '',
      extracted_text text DEFAULT '',
      status text DEFAULT 'ready',
      size_bytes integer DEFAULT 0,
      created_at timestamptz DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_thesis_sources_thesis ON thesis_sources (thesis_id, created_at DESC);
```
- [ ] **Step 3:** Create `src/lib/source-service.ts`:
```typescript
import { Mdocxengine } from "mdocxengine";
import { supabaseAdmin } from "./supabase";
import { db, thesisSources, theses } from "../db";
import { and, eq, desc } from "drizzle-orm";

const MAX_BYTES = 10 * 1024 * 1024;
const BUCKET = process.env.SOURCES_BUCKET || "sources";

function decodeBase64(base64: string): Buffer {
  const cleaned = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  return Buffer.from(cleaned, "base64");
}
function extOf(filename: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(filename || ""); return m ? m[1].toLowerCase() : "";
}
async function ensureBucket(name: string) {
  const { error } = await supabaseAdmin.storage.createBucket(name, { public: false });
  if (error && !/already exists/i.test(error.message)) throw new Error(`bucket: ${error.message}`);
}

/** Extract plain text from a supported buffer; "" + status 'unextracted' for unsupported. */
async function extractText(buffer: Buffer, ext: string): Promise<{ text: string; status: "ready" | "unextracted" }> {
  if (ext === "txt" || ext === "md") return { text: buffer.toString("utf-8"), status: "ready" };
  if (ext === "docx") {
    const engine = await Mdocxengine.loadFromBuffer(buffer);
    const paras = await engine.document.getParagraphs();
    const parts: string[] = [];
    for (const p of paras) { const { text } = await p.getPlainTextSafe(); if (text.trim()) parts.push(text); }
    return { text: parts.join("\n"), status: "ready" };
  }
  return { text: "", status: "unextracted" }; // pdf/image/other — stored but not yet extracted (P6.x)
}

export async function userOwnsThesis(thesisId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: theses.id }).from(theses).where(and(eq(theses.id, thesisId), eq(theses.userId, userId)));
  return !!row;
}

export async function addSource(userId: string, thesisId: string, input: { base64: string; filename: string; title?: string; description?: string }) {
  const buffer = decodeBase64(input.base64);
  if (buffer.length === 0) throw new Error("Empty file");
  if (buffer.length > MAX_BYTES) throw new Error("File too large (max 10 MB)");
  const ext = extOf(input.filename);
  const { text, status } = await extractText(buffer, ext);
  const [row] = await db.insert(thesisSources).values({
    thesisId, userId, title: input.title?.trim() || input.filename, description: input.description?.trim() || "",
    filename: input.filename, fileType: ext || "other", extractedText: text, status, sizeBytes: buffer.length, storagePath: "",
  }).returning();
  try {
    await ensureBucket(BUCKET);
    const path = `${userId}/${thesisId}/${row.id}.${ext || "bin"}`;
    await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { upsert: true });
    await db.update(thesisSources).set({ storagePath: path }).where(eq(thesisSources.id, row.id));
    return { ...row, storagePath: path };
  } catch { return row; } // row already saved with extracted text; storage best-effort
}

export async function listSources(thesisId: string) {
  return db.select({ id: thesisSources.id, title: thesisSources.title, description: thesisSources.description, filename: thesisSources.filename, fileType: thesisSources.fileType, status: thesisSources.status, createdAt: thesisSources.createdAt })
    .from(thesisSources).where(eq(thesisSources.thesisId, thesisId)).orderBy(desc(thesisSources.createdAt));
}
export async function getSourceContent(sourceId: string) {
  const [row] = await db.select().from(thesisSources).where(eq(thesisSources.id, sourceId));
  return row ?? null;
}
export async function deleteSource(sourceId: string) {
  await db.delete(thesisSources).where(eq(thesisSources.id, sourceId));
}
```
Confirm `Mdocxengine.loadFromBuffer` exists (it does — used elsewhere). Confirm `thesisSources` is exported from `../db` (it re-exports `./schema`).
- [ ] **Step 4:** `npx tsc --noEmit` → 0. Commit:
```bash
git add src/db/schema.ts src/db/index.ts src/lib/source-service.ts
git commit -m "feat(server): thesis_sources schema + source-service (extract/store/list)"
```

---

## Task 2: Server — routes

**Files:** Modify `src/routes/thesis.ts`

- [ ] **Step 1:** Add (ownership-checked):
```typescript
import { addSource, listSources, deleteSource, userOwnsThesis as ownsThesis } from "../lib/source-service";

thesisRoutes.get("/:id/sources", async (c) => {
  const userId = c.get("userId"); const id = c.req.param("id");
  if (!(await ownsThesis(id, userId))) return c.json({ error: "Thesis not found" }, 404);
  return c.json(await listSources(id));
});
thesisRoutes.post("/:id/sources", async (c) => {
  const userId = c.get("userId"); const id = c.req.param("id");
  if (!(await ownsThesis(id, userId))) return c.json({ error: "Thesis not found" }, 404);
  const { base64, filename, title, description } = await c.req.json();
  if (typeof base64 !== "string" || typeof filename !== "string") return c.json({ error: "base64 and filename required" }, 400);
  try { const src = await addSource(userId, id, { base64, filename, title, description }); return c.json(src, 201); }
  catch (e: any) { return c.json({ error: e?.message ?? "Upload failed" }, 400); }
});
thesisRoutes.delete("/:id/sources/:sourceId", async (c) => {
  const userId = c.get("userId"); const id = c.req.param("id");
  if (!(await ownsThesis(id, userId))) return c.json({ error: "Thesis not found" }, 404);
  await deleteSource(c.req.param("sourceId"));
  return c.json({ success: true });
});
```
- [ ] **Step 2:** Test `scripts/test-sources.ts`: create a fixture thesis; `addSource(userId, thesisId, { base64: Buffer.from("# Notes\nUse the method X.").toString("base64"), filename: "notes.md", title: "My notes", description: "methodology" })`; assert `listSources` returns 1 with title "My notes" + description "methodology"; `getSourceContent` returns extractedText containing "method X"; cleanup. Run → PASS.
- [ ] **Step 3:** `npx tsc --noEmit` → 0. Commit:
```bash
git add src/routes/thesis.ts scripts/test-sources.ts
git commit -m "feat(server): thesis source routes (add/list/delete)"
```

---

## Task 3: Server — MCP tools + prompt

**Files:** Modify `src/mcp/server.ts`, `src/lib/ai/types.ts`

- [ ] **Step 1:** Register two tools (import `listSources`, `getSourceContent` from `../lib/source-service`; `userOwnsThesis` already in server.ts):
```typescript
server.tool("list_sources", "List the reference/source materials the student attached to a thesis (title + description of what to use from each). Call this to discover what background material is available before drafting.", {
  userId: z.string(), thesisId: z.string(),
}, async ({ userId, thesisId }) => {
  if (!(await userOwnsThesis(thesisId, userId))) return asText("Thesis not found");
  return asText(await listSources(thesisId));
});
server.tool("get_source_content", "Read the extracted text of one attached source material by id (use list_sources first to get ids). Ground your drafting in this material.", {
  userId: z.string(), sourceId: z.string(),
}, async ({ userId, sourceId }) => {
  const src = await getSourceContent(sourceId);
  if (!src || !(await userOwnsThesis(src.thesisId, userId))) return asText("Source not found");
  return asText({ title: src.title, description: src.description, fileType: src.fileType, status: src.status, content: src.extractedText });
});
```
Import `import { listSources, getSourceContent } from "../lib/source-service";`.
- [ ] **Step 2:** `buildToolSystemPrompt` — add a line to the tool list:
```
- The student may attach SOURCE MATERIALS (reference files with a title + a note on what to take from each). Call list_sources to see them and get_source_content to read one, then ground your drafting in that material and cite it where relevant.
```
- [ ] **Step 3:** `npx tsc --noEmit` → 0. Commit:
```bash
git add src/mcp/server.ts src/lib/ai/types.ts
git commit -m "feat(server): list_sources + get_source_content MCP tools; prompt mentions sources"
```

---

## Task 4: App — types + api + store

**Files:** Modify `lib/api.ts`, `types/` (new `types/source.ts`), create `stores/source-store.ts`

- [ ] **Step 1:** `types/source.ts`:
```typescript
export interface ThesisSource {
  id: string; title: string; description: string; filename: string;
  fileType: string; status: "ready" | "unextracted"; createdAt: string;
}
```
- [ ] **Step 2:** `lib/api.ts`:
```typescript
import type { ThesisSource } from "@/types/source";
export async function listSources(thesisId: string) { return apiGet<ThesisSource[]>(`/api/thesis/${thesisId}/sources`); }
export async function addSource(thesisId: string, input: { base64: string; filename: string; title?: string; description?: string }) {
  return apiPost<ThesisSource>(`/api/thesis/${thesisId}/sources`, input);
}
export async function deleteSource(thesisId: string, sourceId: string) { return apiDelete(`/api/thesis/${thesisId}/sources/${sourceId}`); }
```
(Confirm `apiDelete` exists; if it's `apiDelete(path)` returning void, fine.)
- [ ] **Step 3:** Create `stores/source-store.ts` (keyed by thesisId):
```typescript
import { create } from "zustand";
import type { ThesisSource } from "@/types/source";
import { listSources, deleteSource as apiDelete } from "@/lib/api";

interface SourceState {
  byThesis: Record<string, ThesisSource[]>;
  loading: boolean;
  load: (thesisId: string) => Promise<void>;
  add: (thesisId: string, source: ThesisSource) => void;
  remove: (thesisId: string, sourceId: string) => Promise<void>;
}
const EMPTY: ThesisSource[] = [];
export const useSourceStore = create<SourceState>((set, get) => ({
  byThesis: {},
  loading: false,
  load: async (thesisId) => {
    set({ loading: true });
    try { const list = await listSources(thesisId); set((s) => ({ byThesis: { ...s.byThesis, [thesisId]: list } })); }
    catch {/* keep prior */} finally { set({ loading: false }); }
  },
  add: (thesisId, source) => set((s) => ({ byThesis: { ...s.byThesis, [thesisId]: [source, ...(s.byThesis[thesisId] ?? EMPTY)] } })),
  remove: async (thesisId, sourceId) => {
    await apiDelete(thesisId, sourceId);
    set((s) => ({ byThesis: { ...s.byThesis, [thesisId]: (s.byThesis[thesisId] ?? EMPTY).filter((x) => x.id !== sourceId) } }));
  },
}));
```
- [ ] **Step 4:** tsc clean; commit:
```bash
git add lib/api.ts types/source.ts stores/source-store.ts
git commit -m "feat(app): source materials api + store + type"
```

---

## Task 5: App — Sources sheet + workspace entry

**Files:** Create `components/workspace/SourcesSheet.tsx`; Modify `stores/bottom-sheet-store.ts`, `app/(app)/thesis-workspace.tsx`, `locales/*`

- [ ] **Step 1:** `stores/bottom-sheet-store.ts`: add `"thesis-sources"` to `SheetName`.
- [ ] **Step 2:** Create `components/workspace/SourcesSheet.tsx` — a `<BottomSheet name="thesis-sources" snapPoints={["55%","90%"]} keyboardBehavior="extend">` containing:
  - On open, `useSourceStore.getState().load(thesisId)`. Read `byThesis[thesisId] ?? EMPTY` via a selector that uses a STABLE empty constant (avoid the fresh-array footgun — declare `const EMPTY: ThesisSource[] = []` at module scope and select `(s) => s.byThesis[thesisId] ?? EMPTY`).
  - **List**: each source = title (bold) + description (muted) + a small type/status badge + a delete (Trash2) Pressable calling `useSourceStore.getState().remove(thesisId, id)`.
  - **Add form** (inline at top or behind an "＋ Add source" button): a "Choose file" button (DocumentPicker for `.docx`/`.txt`/`.md`; use `type: ["*/*"]` or the docx/text mimetypes; read base64 via `FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 })`), a `TextInput` for title (prefilled from filename), a `TextInput` for description (placeholder "What should the AI take from this?"), and an "Upload" button → `addSource(thesisId, { base64, filename, title, description })` → `useSourceStore.getState().add(thesisId, result)`; show a spinner while uploading; handle errors with Alert.
  - Takes `thesisId` as a prop (pass from the workspace). Use `useThemeColors`, `t(...)`.
- [ ] **Step 3:** `app/(app)/thesis-workspace.tsx`: add a Sources button to the top bar (e.g. `Paperclip` icon from lucide) → `useBottomSheet.getState().openSheet("thesis-sources")`. Render `<SourcesSheet thesisId={thesisId} />` in the screen tree.
- [ ] **Step 4:** i18n: add a `sources` block to en/fr/ar: `{ "title": "Sources", "add": "Add source", "chooseFile": "Choose file", "sourceTitle": "Title", "description": "What should the AI take from this?", "upload": "Upload", "empty": "No sources yet. Add reference files to help the AI.", "unextracted": "Not extracted" }` (translate fr/ar). Validate JSON.
- [ ] **Step 5:** tsc clean (only 8 pre-existing); commit:
```bash
git add components/workspace/SourcesSheet.tsx stores/bottom-sheet-store.ts "app/(app)/thesis-workspace.tsx" locales/
git commit -m "feat(app): sources sheet (upload + list) + workspace entry"
```

---

## Task 6: Verification
- [ ] **Step 1:** `cd /Users/hamzasafwan/modakerati-server && npx tsx scripts/test-sources.ts && npx tsc --noEmit && echo SERVER_OK`.
- [ ] **Step 2:** `cd /Users/hamzasafwan/modakerati && npx tsc --noEmit 2>&1 | grep -E "error TS" | grep -vE "global.css|absoluteFillObject|ProviderSelector"` → empty.
- [ ] **Step 3:** (Manual, user) Workspace → Sources → add a `.docx`/`.md` with a description → it lists. Then ask the AI (composer) something that needs it; the AI can `list_sources`/`get_source_content`.

## Definition of done (P6)
- `thesis_sources` table + extract-on-upload (`.docx`/`.txt`/`.md`); routes add/list/delete; MCP `list_sources`/`get_source_content` + prompt mention.
- Workspace Sources sheet: pick file + title + description → upload → list → delete.
- Both repos type-check (app: only pre-existing unrelated errors).

## Out of scope (P6.x)
- PDF/image text extraction (no dep yet) — such files upload + store but `status: "unextracted"`, `extractedText: ""`.
- Automatic chunking/summarization of very large sources (the tool returns full extracted text; large files may need chunking later).
- Auto-citing sources in the bibliography.
