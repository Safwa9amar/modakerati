# Design — Import .docx as an editable document (Phase 1)

Date: 2026-06-22
Status: Approved (build in progress)

## Goal

Let a user import a Word `.docx` file. The **.docx file itself is the working
document** (source of truth): it is copied into storage, its content read with
our own `mdocxengine`, **edited directly in the file**, and **previewed as the
real docx** in the OS viewer. This is a new standalone "document" entity,
separate from the structured `theses` (chapters/sections) model.

Editing happens via **both** the AI (chat) and the user (in-app editor) — but
AI editing is **Phase 2**. Phase 1 builds the file-centric foundation + the user
editor + native preview, with one shared write path that Phase 2 reuses.

## Decisions (locked)

- Parsing/editing: **server-side**, using `mdocxengine` (docx in / docx out).
- Mapping: **no shredding into chapters/sections** — the docx is kept whole and
  edited paragraph-by-paragraph.
- Entity: **new `documents` table**, independent of `theses`.
- Preview: **download the real .docx → open in OS viewer** (`expo-sharing`;
  iOS Quick Look / Android open-with). No HTML/PDF rendering.
- Editing (Phase 1): **user in-app paragraph editor**. AI chat editing = Phase 2.
- mdocxengine: OK to extend — add `loadFromBuffer` (no temp files).

## Decomposition

- **Phase 1 (this spec):** import + copy to storage, `documents` table, list,
  read content, in-app paragraph editor (edit/insert/delete), native preview.
  Builds the shared `document-service` write path.
- **Phase 2 (later spec):** document-scoped chat + MCP tools that REUSE
  `document-service`. No new write logic.

---

## Interface contract

### mdocxengine (`~/mdocxengine`)

Add buffer loaders (rebuild `dist` after — server consumes the built package):

```ts
// src/utils/ZipManager.ts
static async loadFromBuffer(buffer: Buffer): Promise<ZipManager> {
  return new ZipManager(buffer); // adm-zip ctor already accepts a Buffer
}

// src/index.ts (Mdocxengine)
static async loadFromBuffer(buffer: Buffer): Promise<Mdocxengine> {
  const zm = await ZipManager.loadFromBuffer(buffer);
  return new Mdocxengine(zm); // private ctor, same as loadFromFile
}
```

Round-trip out: `engine.zip.toBuffer()` (already exists).

Reading accessors used by the service (verified against source):
- `engine.document.getParagraphs(): Promise<Paragraph[]>`
- `p.getPlainTextSafe(): Promise<{hasText, text}>`
- `p.getAlignment(): string|null`
- styleId: `p.paragraph["w:pPr"]?.["w:pStyle"]?.$?.["w:val"]`
- paraId: `p.paragraph.$?.["w14:paraId"]`
- `engine.metadata.getCoreProperties()` → `.title`
- `engine.metadata.getAppProperties()` → `.words`, `.pages`
- `p.detectLanguage(): string|null` (e.g. "fr-FR", "ar-SA")

Writing: `p.modifyText(text)`, `p.applyStyle(styleId)`, `p.setAlignment(a)`,
`Run.fromText(text)`, `new Paragraph({ $:{}, "w:pPr":{}, "w:r":[] })`,
`p.generateUniqueParaId(engine.zip)`, `engine.document.saveChanges(paras)`.
All paragraph CRUD is done **by index** via `getParagraphs()` + array splice +
`saveChanges()` (robust; does not depend on paraId presence).

### Server (`~/modakerati-server`)

`documents` table (mirrored in `src/db/schema.ts` AND created idempotently in
`ensureSchema()` in `src/db/index.ts`, matching the existing `news` pattern):

```
documents(
  id uuid pk default gen_random_uuid(),
  user_id uuid not null,
  filename text not null,
  title text not null default '',
  storage_path text not null,
  language text default 'fr',
  word_count integer default 0,
  page_count integer default 0,
  size_bytes integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)
index idx_documents_user (user_id, updated_at desc)
```

`src/lib/document-storage.ts` (mirrors `thesis-export-storage`): private bucket
`documents` (env `DOCUMENTS_BUCKET`), path `{userId}/{docId}.docx`.
- `uploadDocx(userId, docId, buffer)` → `{ path }` (upsert, ensure bucket)
- `downloadDocx(path)` → `Buffer`
- `signDownload(path, filename)` → signed URL (1h TTL, `{ download: filename }`)
- `removeDocx(path)`

`src/lib/document-service.ts` — the shared write path (REST now, MCP in P2):
- `importDocument(userId, {base64, filename, language?})`: validate `.docx` +
  size ≤ 10 MB → load buffer → derive title/language/wordCount/pageCount →
  upload → insert row → return record.
- `getDocumentContent(userId, id)`: load → `paragraphs: ParagraphDTO[]`.
- `editParagraph(userId, id, index, {text?, alignment?, styleId?})`
- `insertParagraph(userId, id, {index?, text, styleId?, alignment?})`
- `deleteParagraph(userId, id, index)`
- `deleteDocument(userId, id)`
- All mutators: download → mutate via mdocxengine → upload → refresh metadata
  (wordCount/pageCount/updatedAt). Last-write-wins (single-user v1).
- Ownership: every op filters `documents.userId == userId` → 404 otherwise.

`src/routes/documents.ts` mounted at `/api/documents` (after auth, in
`src/index.ts`):
- `POST /import` `{base64, filename, language?}` → 201 DocumentRecord
- `GET /` → DocumentRecord[]
- `GET /:id` → DocumentRecord
- `GET /:id/content` → `{ id, title, language, paragraphs: ParagraphDTO[] }`
- `GET /:id/download` → `{ url, filename }`
- `PATCH /:id/paragraphs/:index` `{text?, alignment?, styleId?}` →
  `{ paragraph: ParagraphDTO, document: DocumentRecord }`
- `POST /:id/paragraphs` `{index?, text, styleId?, alignment?}` →
  `{ paragraph: ParagraphDTO, document: DocumentRecord }`
- `DELETE /:id/paragraphs/:index` → `{ document: DocumentRecord }`
- `DELETE /:id` → `{ success: true }`

DTOs:
```ts
DocumentRecord = { id, filename, title, language, wordCount, pageCount,
                   sizeBytes, createdAt, updatedAt }   // storage_path NOT exposed
ParagraphDTO   = { index, paraId: string|null, text, styleId: string|null,
                   level: number|null, alignment: string|null }
Align          = "left" | "center" | "right" | "both"
```
`level`: Heading\d → n; "Title" → 0; else null.
Title derivation: coreProps.title → first Heading/Title paragraph w/ text →
filename (sans `.docx`). Language: first `detectLanguage()` → script heuristic
(Arabic block → ar) → "fr".

### App (`~/modakerati`)

New deps: `expo-file-system`, `expo-sharing` (install via `npx expo install`).
File I/O uses the stable legacy module: `import * as FileSystem from
'expo-file-system/legacy'` (`readAsStringAsync` Base64, `downloadAsync`,
`cacheDirectory`).

- `types/document.ts`: `DocumentRecord`, `ParagraphDTO`, `Align`.
- `lib/api.ts`: `importDocument`, `listDocuments`, `getDocument`,
  `getDocumentContent`, `getDocumentDownload`, `editDocumentParagraph`,
  `addDocumentParagraph`, `deleteDocumentParagraph`, `deleteDocument`.
- `stores/document-store.ts` (Zustand): list, current doc + paragraphs, import
  (pick `.docx` → base64 → upload → returns id), paragraph CRUD, preview
  (download signed URL → `FileSystem.downloadAsync` → `Sharing.shareAsync`).
- `app/(app)/documents.tsx`: list of imported documents + "Import Word
  document" action (DocumentPicker `.docx`). Tap → editor.
- `app/(app)/document-editor.tsx`: editable paragraph list (edit text, set
  alignment / heading style, add/delete paragraph), "Preview" button (opens the
  real docx). Uses `useThemeColors`, trilingual labels.
- Entry point: a row/button on the thesis tab (`app/(tabs)/thesis.tsx`) →
  `/(app)/documents`.
- i18n keys in `locales/{en,fr,ar}.json` under a `documents` namespace.

## Limits & errors

- Reject non-`.docx` and > 10 MB (client + server).
- Corrupt/unreadable docx → 422 with message.
- Missing paragraph index / doc not owned → 404.
- Storage failures → 500 with message.
- Content is never lost: the original file is the document; edits are in-place.

## Out of scope (Phase 1)

AI chat editing (Phase 2), run-level rich formatting (bold/italic per run),
table/image/footnote editing, in-app true-fidelity rendering, concurrent editing.

## Testing / verification

- `mdocxengine`: build succeeds; `loadFromBuffer` round-trips a fixture docx.
- Server: `tsc` clean; service unit logic for parse + edit/insert/delete index ops.
- App: `tsc` clean; manual import → edit → save → preview round-trip.
- Adversarial multi-lens review of the full cross-repo diff.
