# AI Destructive-Tool Confirmation Gate (Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Destructive AI doc tools never execute on the model's say-so: the tool loop parks the exact args as a pending action, the app's Approve tap hits a dedicated endpoint that executes the STORED args, and the conversation continues naturally.

**Architecture:** A pure gate-decision + preview-builder module (unit-tested), a TTL'd `pending_tool_actions` table, an interception point in both tool loops (mirroring the existing `ask_user` short-circuit), a `[[MODK_CONFIRM]]` stream frame (sibling of `[[MODK_ASK]]`), and confirm/cancel endpoints in `routes/chat.ts` that execute-then-continue via an ephemeral history note.

**Tech Stack:** Hono, Drizzle, the existing tool-loop/mcp-bridge machinery, vitest. Repo: `/Users/hamzasafwan/modakerati-server`.

**Depends on:** Plan `2026-07-18-doc-history-server.md` (turn-context ALS, `turnCheckpointSeq`, `makeDocChangesFrame`). Implement that plan first.

**Spec:** `docs/superpowers/specs/2026-07-18-doc-history-ai-confirm-design.md` (app repo), section 5.

---

### Task 1: Schema — `pending_tool_actions`

**Files:**
- Modify: `src/db/schema.ts` (after `thesisDocHistory` from the history plan)

- [ ] **Step 1: Add the table**

```ts
// ============================================================
// Pending tool actions (destructive-AI confirmation gate)
// ============================================================
// A destructive doc tool the model requested but the student hasn't approved
// yet. The tool loop parks the EXACT args here and ends the turn; the app's
// Approve tap executes the stored args via POST /api/chat/confirm-action (the
// model can't alter them post-approval). Short-lived — rows expire after
// ~10 minutes and are lazily cleaned on the next insert.
export const pendingToolActions = pgTable("pending_tool_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  thesisId: uuid("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
  toolName: text("tool_name").notNull(),
  args: jsonb("args").notNull(),
  preview: jsonb("preview").notNull(), // ConfirmPayload["preview"] — {kind, data, text}
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 2: Apply + verify.** `npx drizzle-kit push` (adds one table), `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(gate): pending_tool_actions table for unapproved destructive AI tools"
```

---

### Task 2: Pure gate decision + preview builder

**Files:**
- Create: `src/lib/ai/destructive-gate.ts` (pure part first; IO added in Task 3)
- Test: `src/__tests__/destructive-gate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/__tests__/destructive-gate.test.ts
import { describe, expect, it } from "vitest";
import { DESTRUCTIVE_DOCX_TOOLS, gateDecision, buildActionPreview } from "../lib/ai/destructive-gate";

describe("DESTRUCTIVE_DOCX_TOOLS", () => {
  it("contains exactly the spec'd tools", () => {
    expect([...DESTRUCTIVE_DOCX_TOOLS].sort()).toEqual([
      "delete_block", "front_matter_numbering", "make_thesis_ready",
      "replace_text", "set_footer", "set_header",
      "set_section_footer", "set_section_header",
    ]);
  });
});

describe("gateDecision", () => {
  const none = { hasHeader: false, hasFooter: false };
  const both = { hasHeader: true, hasFooter: true };
  it("always gates the content-destroyers", () => {
    for (const t of ["delete_block", "replace_text", "make_thesis_ready", "front_matter_numbering"]) {
      expect(gateDecision(t, none)).toBe(true);
    }
  });
  it("header/footer tools gate only when overwriting existing content", () => {
    expect(gateDecision("set_header", none)).toBe(false);
    expect(gateDecision("set_header", both)).toBe(true);
    expect(gateDecision("set_section_footer", none)).toBe(false);
    expect(gateDecision("set_footer", both)).toBe(true);
  });
  it("never gates non-destructive tools", () => {
    expect(gateDecision("edit_paragraph", both)).toBe(false);
    expect(gateDecision("read_thesis_blocks", both)).toBe(false);
  });
});

describe("buildActionPreview", () => {
  const blocks = [
    { kind: "paragraph", text: "إهداء" },
    { kind: "paragraph", text: "Merci à tous ceux qui m'ont aidé pendant ces longues années de travail." },
    { kind: "table", text: "" },
  ];
  it("delete_block quotes the target block", () => {
    const p = buildActionPreview("delete_block", { index: 1 }, { blocks, docText: "" });
    expect(p.kind).toBe("delete_block");
    expect(p.data).toMatchObject({ index: 1, blockKind: "paragraph" });
    expect(String(p.data.snippet)).toContain("Merci à tous");
    expect(p.text).toContain("Merci à tous");
  });
  it("delete_block survives an out-of-range index", () => {
    const p = buildActionPreview("delete_block", { index: 99 }, { blocks, docText: "" });
    expect(p.kind).toBe("delete_block");
    expect(p.data).toMatchObject({ index: 99 });
  });
  it("replace_text counts occurrences", () => {
    const p = buildActionPreview("replace_text", { find: "thèse", replace: "mémoire" },
      { blocks: [], docText: "ma thèse … la thèse finale" });
    expect(p.kind).toBe("replace_text");
    expect(p.data).toMatchObject({ find: "thèse", replace: "mémoire", count: 2 });
  });
  it("unknown gated tool falls back to a generic preview", () => {
    const p = buildActionPreview("make_thesis_ready", {}, { blocks: [], docText: "" });
    expect(p.kind).toBe("make_thesis_ready");
    expect(p.text.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/__tests__/destructive-gate.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the pure part**

```ts
// src/lib/ai/destructive-gate.ts
// Hard confirmation gate for destructive doc tools. The system prompt still
// ASKS the model to confirm first (types.ts) — this module is the structural
// backstop: the tool loop refuses to execute these tools without a pending
// action the student approved in the app. Pure decision/preview logic up top
// (unit-tested); IO (doc read + pending-row insert) below.

export const DESTRUCTIVE_DOCX_TOOLS = new Set<string>([
  "delete_block",
  "replace_text",
  "make_thesis_ready",
  "front_matter_numbering",
  "set_header",
  "set_footer",
  "set_section_header",
  "set_section_footer",
]);

// Header/footer setters destroy something only when there IS an existing
// header/footer to overwrite (incl. setting an empty one = removal).
const HEADER_TOOLS = new Set(["set_header", "set_section_header"]);
const FOOTER_TOOLS = new Set(["set_footer", "set_section_footer"]);

export function gateDecision(
  toolName: string,
  existing: { hasHeader: boolean; hasFooter: boolean },
): boolean {
  if (!DESTRUCTIVE_DOCX_TOOLS.has(toolName)) return false;
  if (HEADER_TOOLS.has(toolName)) return existing.hasHeader;
  if (FOOTER_TOOLS.has(toolName)) return existing.hasFooter;
  return true;
}

export interface ActionPreview {
  kind: string; // tool name — the app maps this to a localized template
  data: Record<string, unknown>; // template params (snippet, count, …)
  text: string; // English fallback, also what the model's bubble shows
}

const snippetOf = (s: string, max = 90): string =>
  s.length <= max ? s : `${s.slice(0, max)}…`;

export function buildActionPreview(
  toolName: string,
  args: Record<string, unknown>,
  docCtx: { blocks: { kind: string; text: string }[]; docText: string },
): ActionPreview {
  if (toolName === "delete_block") {
    const index = Number(args.index);
    const target = docCtx.blocks[index];
    const snippet = target ? snippetOf(target.kind === "paragraph" ? target.text : `[${target.kind}]`) : "";
    return {
      kind: toolName,
      data: { index, blockKind: target?.kind ?? "unknown", snippet },
      text: `Delete block ${index}${snippet ? `: «${snippet}»` : ""}`,
    };
  }
  if (toolName === "replace_text") {
    const find = String(args.find ?? "");
    const replace = String(args.replace ?? "");
    let count = 0;
    if (find && !args.regex) {
      count = docCtx.docText.split(find).length - 1;
    }
    return {
      kind: toolName,
      data: { find, replace, count, regex: !!args.regex },
      text: `Replace ${args.regex ? "pattern" : count || "all"} occurrence(s) of «${snippetOf(find, 40)}» with «${snippetOf(replace, 40)}»`,
    };
  }
  if (HEADER_TOOLS.has(toolName) || FOOTER_TOOLS.has(toolName)) {
    const which = HEADER_TOOLS.has(toolName) ? "header" : "footer";
    const next = snippetOf(String(args.text ?? ""), 60);
    return {
      kind: toolName,
      data: { which, next },
      text: next
        ? `Overwrite the existing ${which} with «${next}»`
        : `Remove the existing ${which}`,
    };
  }
  // make_thesis_ready, front_matter_numbering, anything added later.
  return {
    kind: toolName,
    data: { args: JSON.stringify(args).slice(0, 200) },
    text: `Run ${toolName.replace(/_/g, " ")} — this rewrites formatting/content across the whole document`,
  };
}
```

- [ ] **Step 4: Run tests — PASS.** `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/destructive-gate.ts src/__tests__/destructive-gate.test.ts
git commit -m "feat(gate): pure gate decision + action preview builder"
```

---

### Task 3: Gate IO — `maybeGateToolCall`

**Files:**
- Modify: `src/lib/ai/destructive-gate.ts` (append the IO section)

- [ ] **Step 1: Append the IO part** to `destructive-gate.ts`:

```ts
// ── IO: decide-and-park (called from the tool loops) ─────────────────────────
import { and, eq, lt } from "drizzle-orm";
import { db, theses, pendingToolActions } from "../../db";
import { loadThesisEngine, sectionHFDTO } from "../thesis-doc";
import { Doc } from "mdocxengine";

const PENDING_TTL_MS = 10 * 60_000;

export interface ConfirmPayload {
  kind: "confirmAction";
  actionId: string;
  toolName: string;
  preview: ActionPreview;
}

/**
 * If this tool call must be confirmed by the student: park it as a pending
 * action and return the payload the app renders as Approve/Cancel chips.
 * Returns null when the call may execute normally. Fails CLOSED for the
 * always-gated tools (an error while previewing still gates, with a generic
 * preview); fails OPEN only for the header/footer existence check (can't read
 * the doc → treat as no existing content, matching their milder risk).
 */
export async function maybeGateToolCall(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: string; thesisId?: string; docMode?: string },
): Promise<ConfirmPayload | null> {
  if (!DESTRUCTIVE_DOCX_TOOLS.has(toolName)) return null;
  if (ctx.docMode !== "live-docx" || !ctx.thesisId) return null;

  let existing = { hasHeader: false, hasFooter: false };
  let docCtx: { blocks: { kind: string; text: string }[]; docText: string } = { blocks: [], docText: "" };
  try {
    const [row] = await db
      .select({ docPath: theses.docPath })
      .from(theses)
      .where(and(eq(theses.id, ctx.thesisId), eq(theses.userId, ctx.userId)));
    if (row?.docPath) {
      const engine = await loadThesisEngine(row.docPath); // fresh read engine — no lock needed
      const doc = Doc.from(engine);
      const blocks = await doc.blocks();
      docCtx = {
        blocks: blocks.map((b: { kind: string; text?: string }) => ({ kind: b.kind, text: b.text ?? "" })),
        docText: await doc.text(),
      };
      const sections = await sectionHFDTO(engine, blocks as never);
      existing = {
        hasHeader: sections.some((s) => s.header != null),
        hasFooter: sections.some((s) => s.footer != null),
      };
    }
  } catch (e: any) {
    console.warn("gate preview read failed (gating with generic preview):", ctx.thesisId, e?.message ?? e);
  }

  if (!gateDecision(toolName, existing)) return null;

  const preview = buildActionPreview(toolName, args, docCtx);
  // Lazy TTL cleanup, then park the action.
  await db.delete(pendingToolActions).where(
    and(eq(pendingToolActions.userId, ctx.userId), lt(pendingToolActions.expiresAt, new Date())),
  ).catch(() => {});
  const [rowIns] = await db.insert(pendingToolActions).values({
    userId: ctx.userId,
    thesisId: ctx.thesisId,
    toolName,
    args,
    preview,
    expiresAt: new Date(Date.now() + PENDING_TTL_MS),
  }).returning({ id: pendingToolActions.id });

  return { kind: "confirmAction", actionId: rowIns.id, toolName, preview };
}
```

Verify the exact names/signature of `loadThesisEngine` and `sectionHFDTO` in `src/lib/thesis-doc.ts` (`sectionHFDTO(engine, blocks?)` at line ~212; a `DocSectionDTO.header` is `{ text } | null`) and the `Doc`/`blocks()` shapes against `src/mcp/doc-tools.ts` usage — adjust the mapping if `blocks()` items differ.

- [ ] **Step 2: Verify** `npx tsc --noEmit` clean; `npx vitest run` still green (pure tests unaffected).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/destructive-gate.ts
git commit -m "feat(gate): maybeGateToolCall — park destructive calls as pending actions"
```

---

### Task 4: Tool-loop interception + `[[MODK_CONFIRM]]` frame

**Files:**
- Modify: `src/lib/ai/tool-loop.ts`

- [ ] **Step 1: Frame + result field.** Next to the ASK frame constants:

```ts
// Confirmation frame: the model requested a DESTRUCTIVE tool; the call was
// parked (pending_tool_actions) and the turn ends here. The app renders
// Approve/Cancel chips; approval executes the STORED args via
// POST /api/chat/confirm-action. Ephemeral — stripped before persist.
export const CONFIRM_FRAME_OPEN = "[[MODK_CONFIRM]]";
export const CONFIRM_FRAME_CLOSE = "[[/MODK_CONFIRM]]";

export function makeConfirmFrame(p: ConfirmPayload): string {
  return `${CONFIRM_FRAME_OPEN}${JSON.stringify(p)}${CONFIRM_FRAME_CLOSE}`;
}
```

Import `ConfirmPayload` + `maybeGateToolCall` from `./destructive-gate`. Extend `stripControlFrames` with the MODK_CONFIRM pair (same two replaces as the others). Add to `ToolChatResult`:

```ts
  /** Set when a destructive tool was parked pending student approval. */
  confirmAction?: ConfirmPayload;
```

- [ ] **Step 2: Intercept in `chatWithTools`** (blocking loop). Inside the `for (const call of calls)` execution loop, before `runOneTool`:

```ts
        const gatePayload = await maybeGateToolCall(name, args, { userId: opts.userId, thesisId: opts.thesisId, docMode: opts.docMode });
        if (gatePayload) {
          return {
            content: [stripAskFrame(msg?.content ?? ""), gatePayload.preview.text].filter(Boolean).join("\n"),
            model: res.model || model,
            provider: provider.name,
            usage: usage.totalTokens ? usage : undefined,
            toolCalls, toolResults, turnId,
            confirmAction: gatePayload,
          };
        }
```

(Calls earlier in the same step have already executed and been snapshotted — correct; the turn simply ends at the first gated call.)

- [ ] **Step 3: Intercept in `streamChatWithTools`.** In the structured-calls path (`for (const c of calls)`), after parsing `args` and before `runOneTool`:

```ts
        const gatePayload = await maybeGateToolCall(c.name, args, { userId: opts.userId, thesisId: opts.thesisId, docMode: opts.docMode });
        if (gatePayload) {
          yield `\n${gatePayload.preview.text}`;
          yield makeConfirmFrame(gatePayload);
          return result();
        }
```

Mirror the same two lines in the text-call fallback path (`for (const tc of textCalls)`), using `tc.name`/`tc.args`.

- [ ] **Step 4: Verify** `npx tsc --noEmit` + `npx vitest run`. Manual smoke: in a workspace chat, ask the AI to "delete the dedication block". Expected: no deletion happens; the stream ends with the preview line + a `[[MODK_CONFIRM]]{...}` frame; `pending_tool_actions` has one row; the persisted assistant message contains neither the frame nor a claim that the block was deleted.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/tool-loop.ts
git commit -m "feat(gate): tool loops park destructive calls and end the turn with MODK_CONFIRM"
```

---

### Task 5: Confirm / cancel endpoints + continuation

**Files:**
- Modify: `src/routes/chat.ts`

- [ ] **Step 1: Imports.** Add `pendingToolActions` to the `../db` import; `import { connectMcpToolset } from "../lib/ai/mcp-bridge";`, `import { randomUUID } from "node:crypto";`, and `turnCheckpointSeq` / `makeDocChangesFrame` if not already imported by the history plan's Task 8.

- [ ] **Step 2: Shared continuation helper** (place above the routes, near `prepareTurnContext`):

```ts
// Continue the conversation after an out-of-band event (action approved or
// declined) WITHOUT persisting the system note itself — only the assistant's
// reply lands in chat history, so the UI shows a natural follow-up bubble.
function streamContinuation(c: Context, o: {
  userId: string; thesisId: string; note: string;
  provider?: string; model?: string; reasoning?: boolean;
  turnId?: string; // set when a tool already executed under this turn id
}) {
  c.header("X-Accel-Buffering", "no");
  c.header("Cache-Control", "no-cache");
  return streamText(c, async (stream) => {
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    let full = "";
    try {
      const [thesisRow] = await db.select({ docMode: theses.docMode }).from(theses).where(eq(theses.id, o.thesisId));
      const history = [...(await buildChatContext(o.thesisId)), { role: "user" as const, content: o.note }];
      const ai = getProvider((o.provider as ProviderName) || getDefaultProvider());
      const gen = streamChatWithTools(ai, history, {
        userId: o.userId, thesisId: o.thesisId, model: o.model, reasoning: o.reasoning,
        signal: controller.signal, docMode: thesisRow?.docMode ?? undefined,
      });
      let telemetry: StreamResult | undefined;
      while (true) {
        const next = await gen.next();
        if (next.done) { telemetry = next.value; break; }
        full += next.value as string;
        await stream.write(streamSafe(next.value as string));
      }
      // "Undo AI changes" support: the approved tool ran under o.turnId BEFORE
      // this continuation; any further edits the model made ran under
      // telemetry.turnId. Prefer the pre-approved turn's checkpoint.
      for (const tid of [o.turnId, telemetry?.turnId].filter(Boolean) as string[]) {
        const seq = await turnCheckpointSeq(o.thesisId, tid).catch(() => null);
        if (seq != null) {
          const frame = makeDocChangesFrame({
            kind: "docChanges", turnId: tid, checkpointSeq: seq,
            tools: [...new Set(telemetry?.toolCalls.map((t) => t.name) ?? [])],
          });
          full += frame;
          await stream.write(streamSafe(frame));
          break;
        }
      }
    } catch (e: any) {
      console.error("continuation error:", e?.message);
      if (!full) { full = friendlyAiError(e, ""); await stream.write(streamSafe(full)); }
    }
    const toSave = stripControlFrames(full) || full;
    if (toSave) {
      await db.insert(chatMessages).values({ thesisId: o.thesisId, role: "assistant", content: toSave })
        .catch((e) => console.error("DB save assistant error:", e?.message));
    }
  });
}
```

(`Context` from `"hono"`; check what chat.ts already imports and reuse. `buildChatContext` already lives in this file.)

- [ ] **Step 3: The endpoints** (static paths — place BEFORE the `/:thesisId` GET route, same rule as the existing static routes):

```ts
// Approve a parked destructive tool action: execute the STORED args (the model
// cannot alter them post-approval), then stream a natural follow-up reply.
chatRoutes.post("/confirm-action", async (c) => {
  const userId = c.get("userId");
  const { actionId, provider, model, reasoning } = await c.req.json();
  const [action] = await db.select().from(pendingToolActions)
    .where(and(eq(pendingToolActions.id, String(actionId ?? "")), eq(pendingToolActions.userId, userId)));
  if (!action) return c.json({ error: "Action not found or already handled" }, 404);
  await db.delete(pendingToolActions).where(eq(pendingToolActions.id, action.id));
  if (action.expiresAt && action.expiresAt < new Date()) {
    return c.json({ error: "Action expired — ask the assistant again" }, 410);
  }

  const [thesisRow] = await db.select({ docMode: theses.docMode }).from(theses).where(eq(theses.id, action.thesisId));
  const turnId = randomUUID();
  const toolset = await connectMcpToolset({ userId, docMode: thesisRow?.docMode ?? undefined, thesisId: action.thesisId, turnId });
  let resultText: string;
  try {
    resultText = await toolset.callTool(action.toolName, action.args as Record<string, unknown>);
  } catch (e: any) {
    resultText = `Error executing ${action.toolName}: ${e?.message ?? "unknown error"}`;
  } finally {
    await toolset.close().catch(() => {});
  }

  const note = `[SYSTEM NOTE — not from the student's keyboard] The student tapped APPROVE for the pending "${action.toolName}" action. It was already executed server-side. Result: ${resultText.slice(0, 1200)}. Briefly confirm to the student, in their language, what was done. Do NOT run the tool again.`;
  return streamContinuation(c, { userId, thesisId: action.thesisId, note, provider, model, reasoning, turnId });
});

// Decline a parked action: nothing executes; the assistant acknowledges.
chatRoutes.post("/cancel-action", async (c) => {
  const userId = c.get("userId");
  const { actionId, provider, model, reasoning } = await c.req.json();
  const [action] = await db.select().from(pendingToolActions)
    .where(and(eq(pendingToolActions.id, String(actionId ?? "")), eq(pendingToolActions.userId, userId)));
  if (!action) return c.json({ error: "Action not found or already handled" }, 404);
  await db.delete(pendingToolActions).where(eq(pendingToolActions.id, action.id));

  const note = `[SYSTEM NOTE — not from the student's keyboard] The student tapped CANCEL on the proposed "${action.toolName}" action. Do NOT perform it or retry it. Acknowledge briefly in the student's language and ask what they'd like instead.`;
  return streamContinuation(c, { userId, thesisId: action.thesisId, note, provider, model, reasoning });
});
```

- [ ] **Step 4: Verify** `npx tsc --noEmit`; manual round-trip with curl or the app: trigger a gated action (Task 4 smoke), then `POST /api/chat/confirm-action {actionId}` → the tool executes (block actually deleted), a follow-up assistant message streams + persists, a `[[MODK_DOCCHANGES]]` frame arrives (undo works via the history endpoints), and the pending row is gone. Repeat with `/cancel-action` → nothing executed, polite acknowledgment streamed.

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat.ts
git commit -m "feat(gate): confirm/cancel endpoints execute stored args then continue the chat"
```

---

### Task 6: Prompt alignment

**Files:**
- Modify: `src/lib/ai/types.ts` (the "CONFIRM BEFORE LARGE OR DESTRUCTIVE EDITS" block, ~lines 323-328)

- [ ] **Step 1: Append to that block** (keep the existing rules; add):

```
Additionally, the system HARD-GATES these tools: delete_block, replace_text,
make_thesis_ready, front_matter_numbering, and set_header/set_footer/
set_section_header/set_section_footer when they would overwrite an existing
header/footer. Calling one does NOT execute it — the app shows the student an
Approve/Cancel prompt and your turn ends. Therefore: (1) phrase your message as
a REQUEST awaiting approval ("J'ai demandé votre confirmation pour…"), never as
a completed action; (2) do not call ask_user AND the gated tool in the same
turn for the same confirmation — calling the gated tool IS the confirmation
prompt; (3) after the student approves, you'll receive the result in a system
note — only then describe the change as done.
```

- [ ] **Step 2: Verify** `npx tsc --noEmit`; quick chat smoke to confirm the model now says "waiting for your approval"-style phrasing when gated.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/types.ts
git commit -m "feat(gate): system prompt explains the hard gate so the model phrases intent, not completion"
```

---

## Final verification

- [ ] `npx tsc --noEmit` clean, `npx vitest run` green.
- [ ] End-to-end: gated tool → chips payload → approve → executes stored args → DOCCHANGES → history undo reverses it.
- [ ] Negative: approve with a tampered/unknown actionId → 404; expired action → 410; a second approve of the same action → 404 (row already deleted).
