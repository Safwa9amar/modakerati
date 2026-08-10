import type { ChatThread } from "@/lib/api";

export interface ThreadSection {
  /** "pinned" | "none" | a thesisId */
  key: string;
  threads: ChatThread[];
}

/**
 * Panel sections: pinned first, then one per thesis, then unattached.
 * The thesis IS the folder — there is no folders table, by design.
 *
 * This only PARTITIONS. The server already returned the threads in display
 * order, so re-sorting here would silently override that.
 */
export function groupThreads(threads: ChatThread[]): ThreadSection[] {
  const pinned = threads.filter((t) => t.pinned);
  const rest = threads.filter((t) => !t.pinned);
  const byThesis = new Map<string, ChatThread[]>();
  for (const t of rest) {
    const k = t.thesisId ?? "none";
    const list = byThesis.get(k);
    if (list) list.push(t); else byThesis.set(k, [t]);
  }
  const sections: ThreadSection[] = [];
  if (pinned.length) sections.push({ key: "pinned", threads: pinned });
  for (const [key, list] of byThesis) if (key !== "none") sections.push({ key, threads: list });
  const none = byThesis.get("none");
  if (none?.length) sections.push({ key: "none", threads: none });
  return sections;
}
