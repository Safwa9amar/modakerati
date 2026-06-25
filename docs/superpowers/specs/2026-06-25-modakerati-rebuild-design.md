# Modakerati Rebuild — Design Spec

**Date:** 2026-06-25
**Approach:** Incremental refactor (Approach B)
**Scope:** Full rebuild of both app (modakerati) and server (modakerati-server)

---

## 1. Pipeline Architecture

The entire system is built around a 5-stage pipeline, implemented as a clear separation between server engine and app UI.

### Server Engine (modakerati-server)

```
Stage 1: INGEST
  - New thesis: seed .docx from template/outline
  - Import: receive uploaded .docx

Stage 2: PARSE & EXTRACT
  - OOXML unpack (mdocxengine)
  - Extract: headings, paragraphs, tables, images
  - Detect: language, structure, styles used
  - Output: structured BlockModel + metadata

Stage 3: CONTENT INTELLIGENCE (AI)
  - Analyze: structure gaps, content quality
  - Generate: expand sections, translate, improve
  - RAG context: norms + exemplars per profile
  - Tools: block-level edit/insert/delete

Stage 4: FORMAT & COMPLY
  - Apply template profile (fonts, margins, spacing)
  - Fix RTL/LTR, pagination (roman -> arabic)
  - Generate TOC, list of figures/tables
  - Output: standards-compliant .docx

Stage 5: DELIVER
  - Signed download URL
  - Export (docx / future: LaTeX, PDF)
  - Word count, page count, compliance score
```

### RAG Knowledge Base

- **Norms profiles:** JSON configs per university x language x discipline (margins, fonts, spacing, citation style, body preset, cover template)
- **Exemplar chunks:** Embedding store of good thesis sections for AI context (future -- infrastructure now, populate over time)

### App (modakerati)

```
ENTRY FLOWS:
  - New Thesis Wizard: template -> title -> plan -> confirm
  - Import .docx: upload -> analysis -> suggestions

WORKSPACE (both flows land here):
  - Live .docx viewer (read-only blocks)
  - AI Chat composer (send/stream)
  - Source files panel (upload helpers)
  - Structure navigator (outline sheet)

SUPPORTING:
  - Thesis list (home)
  - Profile / Settings
  - Notifications
  - News feed
  - Subscription / Payments
```

---

## 2. Corrected Flows

### Flow A: New Thesis

```
1. Home -> tap "New Thesis"
2. Template Picker
   - Browse by university / discipline / language
   - Or pick "Blank"
   - Each template = a norm profile + optional .docx skeleton
3. Title & Details
   - Enter thesis title
   - Select language (if not from template)
   - Optional: supervisor name, academic year
4. Plan Generation (AI)
   - AI generates outline based on title + template norms
   - Shows: Parts -> Chapters -> Sections
   - User can edit/reorder/add/remove before confirming
5. Confirm -> Create
   - Server seeds .docx from outline + template profile
   - Applies correct formatting (fonts, margins, cover page)
   - Stores in user's private bucket
6. -> Land in Workspace
```

### Flow B: Import Existing .docx

```
1. Home -> tap "Import Thesis"
2. Pick .docx from device
3. Server Pipeline runs:
   - Parse & extract (structure, styles, content)
   - Detect language + guess discipline
   - Analyze against norms:
     - Structure: missing intro? no bibliography? chapters out of order?
     - Formatting: wrong font? bad margins? no TOC? pagination off?
     - Content: weak abstract? short sections? missing citations?
   - Return: analysis report + suggestions list
4. Suggestions Screen
   - Show categorized suggestions (structure / format / content)
   - User can accept/reject each suggestion
   - Optional: pick a template to apply norms from
   - Confirm -> server applies accepted changes
5. -> Land in Workspace
```

### Workspace (shared destination)

```
+------------------------------------------+
|  Thesis Title                      [...]  |
+------------------------------------------+
|                                           |
|  Live .docx view (scrollable blocks)      |
|  - Tap block -> select for AI context     |
|  - Headings styled as outline markers     |
|  - Tables, figures, images inline         |
|                                           |
+------------------------------------------+
|  [Sources] [Outline]            [Export]   |
+------------------------------------------+
|  AI Chat Composer                         |
|  - Type message / instruction             |
|  - AI reads selected blocks + sources     |
|  - AI edits .docx via tools               |
|  - Doc refreshes live after edits         |
+------------------------------------------+
```

**Key behaviors:**
- AI always has context: current thesis structure, selected blocks, uploaded sources
- User uploads helper files (PDFs, articles, previous work) -> AI reads extracted text
- AI can: edit paragraphs, insert sections, add tables/figures, restructure chapters
- After AI edits, the .docx view refreshes to show changes
- User can ask AI to "format my thesis" -> triggers Stage 4 (deterministic formatting pass)

---

## 3. Data Model Changes

### Tables unchanged
- `profiles` -- user accounts, university, language, theme
- `chatMessages` -- chat history per thesis
- `thesisSources` -- uploaded helper files with extracted text
- `subscriptions`, `pushTokens`, `notifications`, `news`

### Tables modified

**`theses`** -- simplify:
- Keep: id, userId, title, language, status, progress, wordCount, pageCount, docPath, createdAt, updatedAt
- Add: `normProfileId` (FK -> normProfiles), `analysisReport` (JSONB -- stored suggestions from import analysis):
  ```jsonc
  {
    "structure": [
      { "id": "s1", "severity": "error"|"warning"|"info", "message": "Missing bibliography section", "fix": "insert_bibliography" }
    ],
    "formatting": [
      { "id": "f1", "severity": "error"|"warning"|"info", "message": "Font is Arial 11, expected Times New Roman 12", "fix": "apply_font" }
    ],
    "content": [
      { "id": "c1", "severity": "error"|"warning"|"info", "message": "Abstract is only 50 words, minimum 200", "fix": null }
    ]
  }
  ```
- Remove: `docMode` (everything is live-docx now), `chatSummary`/`chatSummaryCount` (move to chatSummaries)

**`templates`** -- simplify, reference normProfile:
- id, normProfileId (FK), name, description, docxPath (optional skeleton .docx), structure (JSONB -- default outline), isActive

### Tables added

**`normProfiles`** -- formatting rules per university x language x discipline:
```
id, name, university, language, discipline,
bodyPreset (imrad | chapters | law-humanities),
citationStyle (apa | footnote-ar | ieee),
bindingSide (left | right),
formatting (JSONB): {
  font, fontSize, headingSizes, margins,
  spacing, footnoteFontSize, pagination,
  alignment, tocStyle
}
```

Seeded with researched norms: Biskra, Constantine, El Oued, Ouargla, ENSTI Annaba, generic French, generic Arabic.

**`chatSummaries`** -- extracted from theses:
```
id, thesisId (FK), summary (text), messageCount (int), updatedAt
```

### Tables removed
- `documents` -- importing a .docx now creates a thesis directly. Existing imported docs migrate to theses with status "draft".

---

## 4. Server API Structure

### Pipeline endpoints (new/refactored)
```
POST /api/thesis                    -- Create thesis (Flow A)
POST /api/thesis/import             -- Import .docx (Flow B: upload -> parse -> analyze)
GET  /api/thesis/:id/analysis       -- Get analysis report (suggestions list)
POST /api/thesis/:id/apply          -- Apply accepted suggestions
POST /api/thesis/:id/format         -- Trigger Stage 4 formatting pass
GET  /api/thesis/:id/document       -- Live .docx block model (keep)
GET  /api/thesis/:id/outline        -- Structure from headings (keep)
POST /api/thesis/:id/export         -- Export final .docx (keep)
```

### Kept as-is
```
POST /api/chat/stream               -- AI streaming chat
GET  /api/chat/:thesisId            -- Chat history
POST /api/thesis/generate-plan      -- AI outline generation
GET  /api/thesis                    -- List theses
GET  /api/thesis/:id                -- Get thesis
PUT  /api/thesis/:id                -- Update thesis
DELETE /api/thesis/:id              -- Delete thesis
CRUD /api/thesis/:id/sources        -- Source files
GET  /api/templates                 -- List templates
GET  /api/norm-profiles             -- List norm profiles (NEW)
GET  /api/norm-profiles/:id         -- Get profile details (NEW)
CRUD /api/user/*                    -- Profile, avatar
CRUD /api/notifications/*           -- Notifications
CRUD /api/news/*                    -- News feed
POST /api/enhance/*                 -- Grammar, paraphrase, citations
```

### Removed
```
/api/documents/*                    -- Merged into thesis flow
/api/mcp/*                          -- Legacy MCP direct execution
```

### MCP Tools update
- Keep all block-editing tools (edit_paragraph, insert_paragraph, etc.)
- Add: `analyze_thesis` -- run full analysis (structure + format + content)
- Add: `apply_formatting` -- trigger deterministic formatting pass
- Add: `get_norm_profile` -- so AI knows what norms to enforce

---

## 5. App Screen Map

### Keep (minor tweaks only)
- `(auth)/*` -- all auth screens
- `(tabs)/index` -- home (thesis list + quick actions)
- `(tabs)/chat` -- standalone AI chat
- `(tabs)/profile` -- profile management
- `(tabs)/notifications` -- notification center
- `(app)/news`, `news-detail` -- news feed
- `(app)/edit-profile`, `settings`
- `(app)/subscription`, `payment-*`
- `(app)/export`, `export-success`
- `(app)/network-error`

### Rebuild
- `(app)/template-picker` -- add norm profile selection, filter by university/discipline/language, "Blank" option
- `(app)/thesis-workspace` -- restructure: .docx viewer + chat composer + sources/outline panels
- `(app)/thesis-detail` -- simplify to thesis info + outline + jump-to-workspace

### Add
- `(app)/thesis-title` -- title + details entry (between template picker and plan)
- `(app)/thesis-plan` -- refactor: AI generates outline, user edits inline, confirm creates .docx
- `(app)/import-analysis` -- categorized suggestions after .docx import (accept/reject)

### Delete
- `(app)/documents`, `document-view`, `document-editor` -- merged into thesis flow
- `(app)/section-editor`, `edit-chapter` -- replaced by workspace AI editing
- `(app)/document-preview` -- no longer needed
- `(app)/thesis-preview-a4` -- formatting is server-side now
- `(app)/auto-layout`, `auto-numbering`, `auto-toc`, `list-figures`, `list-tables` -- part of Stage 4
- `(app)/ai-enhance` -- accessible through chat
- `(app)/citations` -- managed through AI chat

### Tabs restructure
- Tab 1: Home (thesis list + quick actions)
- Tab 2: Thesis (filtered view)
- Tab 3: Chat (standalone AI)
- Tab 4: Profile
- Notifications: move to header icon with badge count

---

## 6. Stores Restructure

### Keep (no changes)
- `auth-store`, `profile-store`, `settings-store`
- `notification-store`, `chat-store`, `source-store`
- `offline-store`, `avatar-store`

### Rebuild
- `thesis-store` -- simplify: theses list, current thesis, norm profiles list. Remove block selection (move to workspace-store)
- `thesis-wizard-store` -- match new flow: step (template -> title -> plan -> confirm), selectedTemplate, selectedNormProfile, title, language, generatedPlan, editedPlan

### Add
- `workspace-store` -- thesisId, blocks[], outline[], selectedBlockIndex, isRefreshing, composerText, attachments[], activePanel
- `import-store` -- importedFile, isAnalyzing, analysisReport, acceptedSuggestions[], rejectedSuggestions[], selectedNormProfile

### Delete
- `document-store` -- no more separate documents
- `bottom-sheet-store` -- each sheet manages own visibility
- `chat-head-store` -- floating chat bubble already disabled

### Count: 14 -> 11

---

## 7. Implementation Phases

### Phase 1: Server Pipeline Engine
- Create `normProfiles` table + seed with researched norms (7+ profiles)
- Build analysis engine: parse .docx -> detect structure/formatting/content issues -> return suggestions report
- Build formatting engine: apply norm profile to .docx deterministically (fonts, margins, spacing, RTL, pagination, TOC)
- New endpoints: `/import`, `/analysis`, `/apply`, `/format`, `/norm-profiles`
- Update `templates` table to reference normProfiles

### Phase 2: New Thesis Creation Flow (App + Server)
- Rebuild `template-picker` with norm profile awareness
- New `thesis-title` screen
- Refactor `thesis-plan` for inline editing + confirm
- New `thesis-wizard-store`
- Server: `POST /api/thesis` seeds .docx with correct norm profile formatting

### Phase 3: Import Flow (App + Server)
- New `import-analysis` screen (suggestions accept/reject)
- New `import-store`
- Server: `POST /api/thesis/import` runs full pipeline stages 2+3
- Server: `POST /api/thesis/:id/apply` applies accepted suggestions

### Phase 4: Workspace Rebuild (App)
- New `workspace-store`
- Rebuild `thesis-workspace`: .docx viewer + chat composer + sources/outline panels
- "Format thesis" button -> calls `/format` endpoint
- Source uploads integrated into workspace
- Block selection -> AI context flow

### Phase 5: Cleanup & Polish
- Delete old screens (documents, section-editor, auto-layout, etc.)
- Delete old stores (document-store, bottom-sheet-store, chat-head-store)
- Remove old API routes (`/api/documents/*`, `/api/mcp/*`)
- Update `(tabs)` -- move notifications to header icon
- Update i18n keys (en/fr/ar) for new screens
- Test full flows end-to-end

### Phase 6: RAG Infrastructure (Foundation)
- Set up embedding store (Supabase pgvector or external)
- Build ingestion pipeline for exemplar theses
- Wire RAG context into AI chat system prompt
- Populate with initial exemplars per discipline

---

## 8. Algerian Thesis Norms Reference

Consolidated from official university guides (Biskra, Constantine 3, El Oued, Ouargla, ENSTI Annaba, Alger 1, M'sila).

**Key fact:** NO single national standard. Norms are per-university/faculty. Two axes:
1. Language: French/Latin vs Arabic/RTL
2. Discipline: science/experimental (IMRAD) vs law/humanities (chapters)

### French/Latin theses
- Font: Times New Roman 12pt (some: Calibri 12, Arial 11)
- Spacing: 1.5 line spacing
- Margins: Binding side 3-3.5cm, other 1.5-2.5cm, top/bottom 2-2.5cm
- Pagination: Roman numerals (front matter) -> Arabic (from introduction), centered bottom
- Alignment: Justified
- Footnotes: TNR 10pt

### Arabic theses
- Font: Simplified Arabic 16pt (headings 18-26pt bold)
- Margins: RIGHT binding 3cm, left 1.5cm, top/bottom 2cm
- Footnotes: Simplified Arabic 12pt
- Abstract: Back cover, ~15 lines, bilingual minimum

### Universal structure
1. Cover page (university, faculty, department, title, supervisor, year)
2. Dedications + Acknowledgements
3. Abstracts (Arabic mandatory + FR + EN)
4. Abbreviations list
5. Tables list / Figures list
6. Table of contents
7. General introduction
8. Body chapters (IMRAD for science, Chapitre/Fasl for law/humanities)
9. Conclusion & perspectives
10. Bibliography
11. Appendices

### Sources
- Univ. Biskra (Law dept): fdsp.univ-biskra.dz
- ENSTI Annaba: ensti-annaba.dz/bibliotheque
- Univ. Constantine 3: igtu.univ-constantine3.dz
- Univ. M'sila: univ-msila.dz
- Univ. El Oued: faculty.univ-eloued.dz
- Univ. Ouargla: univ-ouargla.dz/docs/NM-Master.pdf
