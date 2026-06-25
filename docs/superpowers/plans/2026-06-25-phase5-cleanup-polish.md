# Phase 5: Cleanup & Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove deprecated screens, stores, and routes. Clean up navigation. Remove server document routes.

**Architecture:** Delete screens replaced by the new pipeline flows (documents, auto-*, ai-enhance, citations). Delete document-store. Remove server /api/documents and /api/mcp routes. Keep bottom-sheet-store and chat-head-store (still actively used).

**Tech Stack:** Expo Router, Hono

**Working directories:** `~/modakerati` (app) and `~/modakerati-server` (server)

---

## File Map

### App — Delete
| File | Reason |
|------|--------|
| `app/(app)/documents.tsx` | Merged into thesis import flow |
| `app/(app)/document-view.tsx` | Replaced by workspace |
| `app/(app)/document-editor.tsx` | Replaced by AI workspace editing |
| `app/(app)/auto-layout.tsx` | Part of Stage 4 format endpoint |
| `app/(app)/auto-numbering.tsx` | Part of Stage 4 format endpoint |
| `app/(app)/auto-toc.tsx` | Part of Stage 4 format endpoint |
| `app/(app)/list-figures.tsx` | Part of Stage 4 format endpoint |
| `app/(app)/list-tables.tsx` | Part of Stage 4 format endpoint |
| `app/(app)/ai-enhance.tsx` | Accessible through AI chat |
| `app/(app)/citations.tsx` | Managed through AI chat |
| `stores/document-store.ts` | No more separate documents |

### App — Modify
| File | Change |
|------|--------|
| `app/(app)/_layout.tsx` | Remove deleted screen registrations |
| `app/(tabs)/chat.tsx` | Remove navigation to ai-enhance |
| `stores/index.ts` | Remove document-store export (if exists) |

### Server — Modify
| File | Change |
|------|--------|
| `src/index.ts` | Remove /api/documents and /api/mcp route registration |

---

### Task 1: Delete deprecated app screens

**Files to delete (app):**
- `app/(app)/documents.tsx`
- `app/(app)/document-view.tsx`
- `app/(app)/document-editor.tsx`
- `app/(app)/auto-layout.tsx`
- `app/(app)/auto-numbering.tsx`
- `app/(app)/auto-toc.tsx`
- `app/(app)/list-figures.tsx`
- `app/(app)/list-tables.tsx`
- `app/(app)/ai-enhance.tsx`
- `app/(app)/citations.tsx`

Check each file exists before deleting (some may already be deleted in git).

Commit: `git commit -m "chore: delete deprecated screens (documents, auto-*, ai-enhance, citations)"`

---

### Task 2: Remove screen registrations from _layout.tsx

**File:** `app/(app)/_layout.tsx`

Read the file. Remove `<Stack.Screen>` entries for all deleted screens:
- `documents`
- `document-view`
- `document-editor`
- `auto-layout`
- `auto-numbering`
- `auto-toc`
- `list-figures`
- `list-tables`
- `ai-enhance`
- `citations`

Keep all other screen registrations.

Commit: `git commit -m "chore: remove deleted screen registrations from app layout"`

---

### Task 3: Delete document-store + clean up references

**Files:**
- Delete: `stores/document-store.ts`
- Modify: `stores/index.ts` (if it exports document-store)

Read `stores/index.ts`. If it re-exports from `./document-store`, remove that line.

Also search for any remaining imports of `document-store` in the codebase and remove them if the importing file was already deleted.

Commit: `git commit -m "chore: delete document-store (merged into thesis import flow)"`

---

### Task 4: Clean up navigation references to deleted screens

**Files to check and modify:**
- `app/(tabs)/chat.tsx` — has `router.push("/(app)/ai-enhance")` reference. Remove or replace with a chat-based alternative.
- Any other file that navigates to deleted screens.

For chat.tsx: the ai-enhance navigation should be removed. If there's a button/card that triggers it, either remove the button or make it send a chat message instead.

Commit: `git commit -m "chore: remove navigation references to deleted screens"`

---

### Task 5: Remove server /api/documents and /api/mcp routes

**File:** `~/modakerati-server/src/index.ts`

Read the file. Remove:
1. The import of `documentRoutes` from `./routes/documents`
2. The import of `mcpRoutes` from `./routes/mcp`
3. The route registrations: `app.route("/api/documents", documentRoutes)` and `app.route("/api/mcp", mcpRoutes)`

Do NOT delete the actual route files (they may still be referenced elsewhere or useful for reference). Just unregister them.

Commit: `git commit -m "chore: unregister /api/documents and /api/mcp routes from server"`

---

### Task 6: Verify both repos compile

```bash
cd ~/modakerati && npx tsc --noEmit 2>&1 | grep -v "global.css\|absoluteFillObject\|getProviderHealth\|ProviderHealth\|setAIProvider\|getAIProvider\|AIProvider\|implicitly has an 'any'" | head -20
cd ~/modakerati-server && npx vitest run
```

Fix any new errors and commit.

---

## Phase 5 Deliverables Checklist

- [ ] 10 deprecated screens deleted
- [ ] Screen registrations removed from _layout
- [ ] document-store deleted
- [ ] Navigation references cleaned up
- [ ] Server /api/documents and /api/mcp unregistered
- [ ] Both repos compile clean
