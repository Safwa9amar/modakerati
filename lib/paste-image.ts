import { Alert } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import i18n from "@/lib/i18n";
import { useThesisDocStore } from "@/stores/thesis-doc-store";

// Paste an image straight out of the system clipboard into the thesis — the
// no-detour twin of `pickAndInsertImage` (which opens the photo library). Used by
// the Insert menu's "Paste image" tile and the block bubble's paste chip. The bytes
// travel through the same durable `insertImage` op, so the paste is optimistic,
// undoable and index-safe exactly like a picked image.
//
// expo-clipboard hands back a DATA URI (`data:image/png;base64,…`) plus the pixel
// size; the op wants raw base64, so the prefix is stripped here.

// A Word text column is ~16cm wide: past ~1600px the extra pixels are invisible in
// the document but real weight in the .docx and in the op payload. Anything bigger
// (or heavier than ~2MB of bytes — a phone screenshot of a photo can be) is
// downscaled and re-encoded as JPEG on device before it goes anywhere.
const MAX_DIM = 1600;
const MAX_B64 = 2_800_000;

export interface ClipboardImage {
  data: string; // base64 (no data: prefix)
  format: "png" | "jpeg";
  width?: number;
  height?: number;
}

// Module-scoped so concurrent taps across ANY caller coalesce — same guard shape as
// `pickAndInsertImage`. The clipboard read is a system dialog on iOS 16+, and firing
// two of those at once is how you get a stuck prompt.
let reading = false;

/**
 * Read the clipboard as an image, shrinking it when it's oversized. Returns null
 * when the clipboard holds no image — on iOS 16+ that also covers the user denying
 * the paste prompt (the platform gives no way to tell the two apart).
 */
export async function readClipboardImage(): Promise<ClipboardImage | null> {
  // hasImageAsync never prompts; getImageAsync may. Checking first means a user with
  // a text-only clipboard gets our message instead of a system paste dialog.
  if (!(await Clipboard.hasImageAsync())) return null;
  // Ask for PNG: lossless, and it keeps the transparency screenshots/logos carry.
  const img = await Clipboard.getImageAsync({ format: "png" });
  if (!img?.data) return null;
  const b64 = img.data.slice(img.data.indexOf(",") + 1);
  if (!b64) return null;
  const { width, height } = img.size ?? { width: 0, height: 0 };
  if (b64.length <= MAX_B64 && Math.max(width, height) <= MAX_DIM) {
    return { data: b64, format: "png", width: width || undefined, height: height || undefined };
  }
  return await shrink(b64, width, height);
}

/** Downscale to MAX_DIM on the long edge and re-encode as JPEG. Falls back to the
 *  untouched PNG if the manipulator can't do it — an oversized figure beats none. */
async function shrink(b64: string, width: number, height: number): Promise<ClipboardImage> {
  const original: ClipboardImage = { data: b64, format: "png", width: width || undefined, height: height || undefined };
  const file = `${FileSystem.cacheDirectory}paste-${Date.now()}.png`;
  try {
    await FileSystem.writeAsStringAsync(file, b64, { encoding: FileSystem.EncodingType.Base64 });
    let ctx = ImageManipulator.manipulate(file);
    if (Math.max(width, height) > MAX_DIM) {
      ctx = ctx.resize(width >= height ? { width: MAX_DIM } : { height: MAX_DIM });
    }
    const rendered = await ctx.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
    if (!out.base64) return original;
    return { data: out.base64, format: "jpeg", width: out.width, height: out.height };
  } catch {
    return original;
  } finally {
    void FileSystem.deleteAsync(file, { idempotent: true }).catch(() => {});
  }
}

/**
 * Insert the clipboard image as a new figure block AFTER `afterIndex`. Alerts (and
 * resolves false) when there's nothing pasteable, so every caller can stay a
 * one-liner. Never throws.
 */
export async function pasteImageFromClipboard(thesisId: string, afterIndex: number): Promise<boolean> {
  const img = await takeClipboardImage();
  if (!img) return false;
  void useThesisDocStore.getState().mutate(thesisId, {
    type: "insertImage",
    afterIndex,
    data: img.data,
    format: img.format,
    width: img.width,
    height: img.height,
  });
  return true;
}

/** Shared read + user-facing failure messages for the paste entry points. */
async function takeClipboardImage(): Promise<ClipboardImage | null> {
  if (reading) return null;
  reading = true;
  let img: ClipboardImage | null;
  try {
    img = await readClipboardImage();
  } catch {
    Alert.alert(i18n.t("workspace.pasteImageError", { defaultValue: "Couldn't paste the image." }));
    return null;
  } finally {
    reading = false;
  }
  if (!img) {
    Alert.alert(
      i18n.t("workspace.clipboardNoImage", {
        defaultValue: "No image in the clipboard. Copy an image first, then paste it here.",
      }),
    );
    return null;
  }
  return img;
}
