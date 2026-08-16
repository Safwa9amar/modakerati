import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { FilePayload } from "@/types/chat";

// Where exports are staged before being handed to the OS. The cache directory
// on purpose: once the student has saved or opened the file, our copy is
// disposable and the system may reclaim it.
const EXPORT_DIR = "exports";

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  latex: "application/x-tex",
  tex: "application/x-tex",
};

/**
 * A filename the filesystem will actually accept.
 *
 * Thesis titles are frequently Arabic, and the server's own filenames carry
 * bidi control characters (the export URL showed a run of %E2%80%8E — left-to-
 * right marks). Those are invisible, legal in a title, and a menace in a path,
 * so they come out along with anything that could change the directory.
 */
function safeFilename(name: string, format: string): string {
  const cleaned = name
    .replace(/[‎‏‪-‮⁦-⁩]/g, "") // bidi controls
    .replace(/[/\\:*?"<>|]/g, "-") // path + reserved characters
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || "thesis";
  return /\.[a-z0-9]{2,5}$/i.test(base) ? base : `${base}.${format || "docx"}`;
}

/**
 * The parts of an export this actually reads.
 *
 * A FilePayload off a chat file card satisfies it, and so does a fresh
 * /api/export response — which carries no `size` and no `pages`, and should not
 * have to invent them to be downloadable.
 */
export type DownloadableExport = Pick<FilePayload, "url" | "filename" | "format" | "title">;

/**
 * Download an exported artifact and hand it to the OS — Save to Files, open in
 * Word, share to anything.
 *
 * Deliberately NOT a browser hand-off. The export URL is a signed Supabase link
 * whose query string carries a JWT; opening it externally puts that token in
 * the browser's history and address bar. Fetching it here keeps it inside the
 * app, and the student gets the file rather than a web page.
 *
 * Throws on failure so the caller can say what happened. The most likely cause
 * is an expired link: these are signed for one hour, so a card from an older
 * conversation will refuse.
 */
export async function downloadExport(file: DownloadableExport): Promise<void> {
  const dir = new Directory(Paths.cache, EXPORT_DIR);
  if (!dir.exists) dir.create({ intermediates: true });

  const target = new File(dir, safeFilename(file.title?.trim() || file.filename, file.format));
  // A re-download of the same export must overwrite rather than land beside the
  // old copy as "thesis (1).docx".
  if (target.exists) target.delete();

  const saved = await File.downloadFileAsync(file.url, target);

  if (!(await Sharing.isAvailableAsync())) {
    // No share sheet (rare — some Android builds). The file IS downloaded, so
    // say that rather than implying nothing happened.
    throw new Error("sharing-unavailable");
  }

  await Sharing.shareAsync(saved.uri, {
    mimeType: MIME[(file.format || "docx").toLowerCase()] ?? "application/octet-stream",
    dialogTitle: target.name,
    UTI: file.format === "pdf" ? "com.adobe.pdf" : "org.openxmlformats.wordprocessingml.document",
  });
}
