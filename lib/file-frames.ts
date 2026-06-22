import type { FilePayload } from "@/types/chat";

// Markers must match the server (src/lib/ai/tool-loop.ts). A file artifact is sent
// as `[[MODK_FILE]]{json}[[/MODK_FILE]]`. Unlike ask/think frames, this one is kept
// in the persisted message content, so we also parse it on history reload.
export const FILE_FRAME_OPEN = "[[MODK_FILE]]";
export const FILE_FRAME_CLOSE = "[[/MODK_FILE]]";

const FILE_FRAME_RE = /\[\[MODK_FILE\]\]([\s\S]*?)\[\[\/MODK_FILE\]\]/g;

function toFile(json: string): FilePayload | null {
  try {
    const f = JSON.parse(json);
    if (f && typeof f.url === "string") return f as FilePayload;
  } catch {
    /* malformed frame — ignore */
  }
  return null;
}

/**
 * Pull every complete [[MODK_FILE]] frame out of a message's content, returning the
 * cleaned display text plus the parsed files. Used when rendering stored/finished
 * messages (the streamed path strips frames live and attaches files separately).
 */
export function splitFileFrames(content: string): { text: string; files: FilePayload[] } {
  const files: FilePayload[] = [];
  let text = content.replace(FILE_FRAME_RE, (_m, json) => {
    const f = toFile(json);
    if (f) files.push(f);
    return "";
  });
  // Drop any dangling, unclosed open frame (e.g. a mid-stream remnant).
  text = text.replace(/\[\[MODK_FILE\]\][\s\S]*$/g, "");
  return { text: text.trim(), files };
}
