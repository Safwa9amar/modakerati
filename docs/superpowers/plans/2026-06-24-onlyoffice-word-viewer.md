# OnlyOffice Docs — Word-fidelity viewer/editor for the live .docx

**Decision (user):** replace the docx-preview DOM render with **OnlyOffice Docs** (HTML5-canvas editor, OOXML-native — the same canvas approach Google Docs/Word use). Server runs on a container/VM, so we self-host the **Document Server**. Editing stays AI-driven for v1 (view mode); direct typing + live AI is a later phase.

## Why
docx-preview reconstructs the doc in the DOM → mediocre fidelity + full-page reload on edit. OnlyOffice renders the **real bytes to canvas** ("100% equality, looks the same in any browser/format"), so the cover, borders, Sommaire, tables and fonts come through exactly. It's embeddable via its DocEditor JS API.

## Architecture / data flow
```
App WebView ──loads──▶ ONLYOFFICE_DS_URL/web-apps/apps/api/documents/api.js
   │  new DocsAPI.DocEditor(ph, config)   (config signed as a JWT by our server)
   ▼
Document Server ──GET document.url──▶ Supabase Storage (signed .docx URL)
Document Server ──POST callbackUrl──▶ our server  (on save: download edited .docx → Storage)
```
Three reachability requirements (document in README):
- **App → DS**: `ONLYOFFICE_DS_URL` must be a public HTTPS URL the device can load.
- **DS → document.url**: the Supabase signed URL (already public, 1h TTL via `signDownload`).
- **DS → callbackUrl**: `ONLYOFFICE_CALLBACK_BASE` must be a URL the DS can POST to (internal VPC URL if co-located, else public).
- **JWT**: server `ONLYOFFICE_JWT_SECRET` === DS `JWT_SECRET` (HS256). All configs + callbacks are signed/verified.

## Phasing
- **O1 (this plan): view-mode viewer.** Embed OnlyOffice read-only; AI edits the .docx (existing block tools) → editor reloads with a new `key` after each turn. Big fidelity win; reload is per-AI-turn (canvas init), not per keystroke. Keep docx-preview (`WordDocxView`) as a fallback when `ONLYOFFICE_DS_URL` is unset.
- **O2 (later): edit mode + live AI.** Open in edit mode (direct typing like Word). AI edits applied to the *open* document live via an OnlyOffice plugin/macro (no reload). Requires a plugin + a backend→plugin channel + force-save coordination.

---

## Infra: Document Server (the user deploys on their VM)
`docker-compose.onlyoffice.yml` (committed to the server repo as a reference):
```yaml
services:
  onlyoffice-docs:
    image: onlyoffice/documentserver:8.2
    environment:
      - JWT_ENABLED=true
      - JWT_SECRET=${ONLYOFFICE_JWT_SECRET}
      - JWT_HEADER=Authorization
    ports: ["8080:80"]            # put behind TLS (reverse proxy) → https://docs.<domain>
    volumes:
      - ds_data:/var/www/onlyoffice/Data
      - ds_log:/var/log/onlyoffice
      - ds_cache:/var/lib/onlyoffice
volumes: { ds_data: {}, ds_log: {}, ds_cache: {} }
```
Deploy steps + env in `README` (TLS via the existing reverse proxy; the DS must reach Supabase + our server).

## Server (`~/modakerati-server`)
1. **`src/lib/onlyoffice.ts`**
   - `isOnlyOfficeEnabled()` → `!!process.env.ONLYOFFICE_DS_URL && !!process.env.ONLYOFFICE_JWT_SECRET`.
   - `docKey(thesis)` → sanitized `${thesisId}_${updatedAtMs}` (≤128 chars, `[A-Za-z0-9_-]`). Changes whenever the doc changes (updatedAt bumped on save) → forces the DS to reload fresh bytes.
   - `buildEditorConfig({ thesis, url, callbackUrl, mode, user, lang })` → the DocEditor config object (`document.fileType="docx"`, `key`, `title`, `url`, `permissions`; `documentType:"word"`; `editorConfig.mode`, `callbackUrl`, `user`, `customization`).
   - `signConfig(config)` → `config.token = await sign(config, SECRET, "HS256")` (via `hono/jwt`).
   - `verifyCallbackToken(token)` → `verify(token, SECRET)`; throws on bad.
2. **`GET /api/thesis/:id/editor-config`** (in `thesisRoutes`, user-auth):
   - Load thesis (owner-scoped); require live-docx + docPath. If `!isOnlyOfficeEnabled()` → `{ enabled:false }` (app falls back to docx-preview).
   - `url = signDownload(docPath, "<slug>.docx")`; `callbackUrl = ${ONLYOFFICE_CALLBACK_BASE}/onlyoffice/callback/${id}`.
   - mode `"view"` (O1). Return `{ enabled:true, documentServerUrl: ONLYOFFICE_DS_URL, config: signedConfig }`.
3. **`POST /onlyoffice/callback/:thesisId`** — NEW `src/routes/onlyoffice.ts`, mounted at `app.route("/onlyoffice", onlyofficeRoutes)` **outside** the `/api/*` auth (the DS has no user token; it's secured by the JWT in the `Authorization: Bearer` header / body `token`).
   - Verify the callback JWT. Resolve the thesis by `:thesisId` (admin, no user ctx) → its `docPath`.
   - `status === 2 || status === 6` (MustSave/ForceSave): `fetch(body.url)` (edited .docx from DS) → `uploadDocx(userId, thesisId, buf)` (overwrite docPath) → bump `theses.updatedAt`. Always respond `{ error: 0 }` (even on no-op statuses 1/3/4).
4. **Touch updatedAt on every .docx save** so `docKey` changes: in the block-tool save path (`doc-tools.ts` / `thesis-doc.ts` write) add `db.update(theses).set({ updatedAt: new Date() })`. (Verify whether it already does; add if not.)
5. **`.env.example`** + README: `ONLYOFFICE_DS_URL`, `ONLYOFFICE_JWT_SECRET`, `ONLYOFFICE_CALLBACK_BASE`, (`DOCUMENTS_BUCKET` already exists).

## App (`~/modakerati`)
1. **`lib/api.ts`**: `EditorConfigDTO = { enabled:false } | { enabled:true; documentServerUrl:string; config:any }`; `getThesisEditorConfig(id)` → `GET /api/thesis/:id/editor-config`.
2. **`components/workspace/OnlyOfficeView.tsx`**: a WebView whose HTML loads `${documentServerUrl}/web-apps/apps/api/documents/api.js`, then `new DocsAPI.DocEditor("ph", config)`. Props: `documentServerUrl`, `config`, `onReady`. A loading overlay until the editor's `onDocumentReady`. Re-mount (new config/key) → reload via rebuilding the HTML (keyed on `config.document.key`).
3. **Wire into `thesis-workspace.tsx`**: for live-docx, fetch `getThesisEditorConfig`. If `enabled` → render `<OnlyOfficeView>`; else fall back to the existing `<WordDocxView>` (docx-preview). After an AI turn ends (existing `prevGenerating` effect), re-fetch the editor-config (new `key`) → the OnlyOffice view reloads the updated doc.
4. Selection/tap-to-target: not exposed by OnlyOffice in view mode for v1 — the composer still works without an auto-selected block (AI uses `find_in_thesis`). Revisit in O2 via the plugin selection API.

## Verification (what I can/can't do)
- I CAN: typecheck both repos; assert the config is a valid signed JWT; unit-check `docKey`/`buildEditorConfig`; confirm the callback verifies + saves given a fake DS payload.
- I CANNOT (needs the deployed DS): end-to-end render + save round-trip. The user deploys the Document Server (compose above) + sets the 3 env vars, then we validate on a device.

## Risks
- Reachability (DS↔Supabase↔our server) — the #1 setup pitfall; documented above.
- `key` staleness → stale render after edit; mitigated by bumping updatedAt on save.
- View-mode reload per AI turn (canvas init latency) — acceptable for O1; O2 removes it.
- License: OnlyOffice community is AGPL; note for the user (commercial license if needed).
