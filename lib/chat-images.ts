import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import i18n from "@/lib/i18n";
import { readClipboardImage } from "@/lib/paste-image";
import type { ChatImage } from "@/types/chat";

// Images a student attaches to a chat message — picked from the library, taken
// with the camera, or pasted from the clipboard.
//
// Everything is normalised on device before it goes anywhere: a modern phone
// photo is 12 MP and 4 MB, which no vision model can use at that size and no
// student wants to upload over campus wifi. Downscaling here also keeps the
// request body small enough that the base64 convention (binary/multipart bodies
// are unreliable from RN — see lib/api.ts) stays practical.

// Long-edge cap. 1568px is the point past which the mainstream vision models
// downsample anyway, so anything larger is bytes spent for no extra detail.
const MAX_DIM = 1568;
// Base64 budget per image (~2 MB of bytes). A PNG that busts it is re-encoded as
// JPEG rather than sent as-is.
const MAX_B64 = 2_800_000;

/** How many images may ride on one message. Mirrors MAX_ATTACHMENTS server-side. */
export const MAX_CHAT_IMAGES = 4;

// Types the server accepts as-is (see lib/chat-attachment-storage.ts). Anything
// else — HEIC above all, which is what an iPhone actually stores — is transcoded
// to JPEG here, because most providers reject it outright.
const PASSTHROUGH_MIME: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

/** An image staged in the composer, ready to send. `uri` is a local file used for
 *  the thumbnail and for re-reading the bytes if the send has to be retried. */
export interface StagedImage {
  uri: string;
  base64: string;
  mime: string;
  width?: number;
  height?: number;
}

// ── Frames ────────────────────────────────────────────────────────────────────
// Markers must match the server (src/lib/ai/tool-loop.ts). An attached image is
// stored on the user's message as `[[MODK_IMG]]{json}[[/MODK_IMG]]`, the same way
// assistant artifacts ride in [[MODK_FILE]] — so it survives history reload and
// the on-device SQLite cache with no schema change on either side.
export const IMG_FRAME_OPEN = "[[MODK_IMG]]";
export const IMG_FRAME_CLOSE = "[[/MODK_IMG]]";

const IMG_FRAME_RE = /\[\[MODK_IMG\]\]([\s\S]*?)\[\[\/MODK_IMG\]\]/g;

/**
 * Pull every [[MODK_IMG]] frame out of a message, returning the display text plus
 * the parsed images. Safe on any content — text with no frame comes back as-is.
 */
export function splitImageFrames(content: string): { text: string; images: ChatImage[] } {
  const images: ChatImage[] = [];
  let text = content.replace(IMG_FRAME_RE, (_m, json) => {
    try {
      const p = JSON.parse(json);
      if (p && typeof p.url === "string") images.push({ ...p, kind: "image" } as ChatImage);
    } catch {
      /* malformed frame — never show the student raw JSON */
    }
    return "";
  });
  // Drop a dangling, unclosed open frame the way splitFileFrames does.
  text = text.replace(/\[\[MODK_IMG\]\][\s\S]*$/g, "");
  return { text: text.trim(), images };
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Resize / re-encode an image into something sendable, and always come back with
 * base64 in hand. Untouched when it's already an accepted type, within the pixel
 * cap and within the byte budget — the common case for a screenshot.
 */
async function normalize(input: {
  uri: string;
  base64?: string;
  mime?: string;
  width?: number;
  height?: number;
}): Promise<StagedImage> {
  const mime = PASSTHROUGH_MIME[(input.mime ?? "").toLowerCase()];
  let { width, height } = input;

  const withinPixels = width != null && height != null && Math.max(width, height) <= MAX_DIM;
  const withinBytes = !!input.base64 && input.base64.length <= MAX_B64;
  if (mime && withinPixels && withinBytes) {
    return { uri: input.uri, base64: input.base64!, mime, width, height };
  }

  // Dimensions we don't already know cost one decode to learn — but they decide
  // whether to resize at all, and resizing blind would UPSCALE a small image.
  if (width == null || height == null) {
    const probe = await ImageManipulator.manipulate(input.uri).renderAsync();
    width = probe.width;
    height = probe.height;
  }

  let ctx = ImageManipulator.manipulate(input.uri);
  if (Math.max(width, height) > MAX_DIM) {
    ctx = ctx.resize(width >= height ? { width: MAX_DIM } : { height: MAX_DIM });
  }
  const rendered = await ctx.renderAsync();

  // Keep PNG for PNG sources: in a thesis app most of them are screenshots of
  // text or of a supervisor's comments, and JPEG artefacts land exactly on the
  // small type the model is being asked to read. Photos (and anything oversized
  // after a PNG pass) go to JPEG.
  if (mime === "image/png") {
    const png = await rendered.saveAsync({ format: SaveFormat.PNG, base64: true });
    if (png.base64 && png.base64.length <= MAX_B64) {
      return { uri: png.uri, base64: png.base64, mime: "image/png", width: png.width, height: png.height };
    }
  }
  const jpg = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!jpg.base64) throw new Error("Could not encode image");
  return { uri: jpg.uri, base64: jpg.base64, mime: "image/jpeg", width: jpg.width, height: jpg.height };
}

// ── Entry points ──────────────────────────────────────────────────────────────

// Module-scoped so concurrent taps coalesce — same guard shape as
// pickAndInsertImage. Two pickers (or two clipboard reads, which prompt on
// iOS 16+) opened at once is how you get a stuck system dialog.
let busy = false;

function failed(): null {
  Alert.alert(i18n.t("chat.imageError", { defaultValue: "Couldn't attach that image." }));
  return null;
}

/** Open the photo library. Multi-select, capped at `remaining` slots. */
export async function pickChatImages(remaining: number): Promise<StagedImage[]> {
  if (busy || remaining <= 0) return [];
  busy = true;
  try {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        i18n.t("chat.permissionNeeded", { defaultValue: "Permission needed" }),
        i18n.t("chat.photoPermission", { defaultValue: "Please allow access to your photo library." }),
      );
      return [];
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      base64: true,
      quality: 0.9,
      allowsMultipleSelection: remaining > 1,
      selectionLimit: remaining,
    });
    if (res.canceled) return [];
    return await normalizeAll(res.assets);
  } catch {
    failed();
    return [];
  } finally {
    busy = false;
  }
}

/** Take a photo with the camera and stage it. */
export async function captureChatImage(): Promise<StagedImage | null> {
  if (busy) return null;
  busy = true;
  try {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        i18n.t("chat.permissionNeeded", { defaultValue: "Permission needed" }),
        i18n.t("chat.cameraPermission", { defaultValue: "Please allow access to your camera." }),
      );
      return null;
    }
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], base64: true, quality: 0.9 });
    if (res.canceled || !res.assets?.[0]) return null;
    const [staged] = await normalizeAll(res.assets);
    return staged ?? null;
  } catch {
    return failed();
  } finally {
    busy = false;
  }
}

/**
 * Stage the image sitting in the system clipboard. Returns null (with a message)
 * when there isn't one — on iOS 16+ that also covers the user declining the paste
 * prompt, which the platform gives no way to distinguish.
 */
export async function pasteChatImage(): Promise<StagedImage | null> {
  if (busy) return null;
  busy = true;
  try {
    const img = await readClipboardImage();
    if (!img) {
      Alert.alert(
        i18n.t("chat.clipboardNoImage", {
          defaultValue: "No image in the clipboard. Copy an image first, then paste it here.",
        }),
      );
      return null;
    }
    // The clipboard hands over bytes, not a file. Write them out so a pasted
    // image behaves exactly like a picked one from here on — a real uri for the
    // thumbnail, and something to re-read from if the send has to be retried.
    const mime = img.format === "png" ? "image/png" : "image/jpeg";
    const uri = `${FileSystem.cacheDirectory}chat-paste-${Date.now()}.${img.format === "png" ? "png" : "jpg"}`;
    await FileSystem.writeAsStringAsync(uri, img.data, { encoding: FileSystem.EncodingType.Base64 });
    return await normalize({ uri, base64: img.data, mime, width: img.width, height: img.height });
  } catch {
    return failed();
  } finally {
    busy = false;
  }
}

/**
 * Re-read a staged image from its local file — the retry path for a send that
 * never landed. Returns null if the file is gone (the OS reclaims the cache
 * directory), in which case the retry goes out as text alone rather than failing.
 */
export async function restageImage(image: ChatImage): Promise<StagedImage | null> {
  if (!image.uri) return null;
  try {
    return await normalize({ uri: image.uri, mime: image.mime, width: image.width, height: image.height });
  } catch {
    return null;
  }
}

async function normalizeAll(assets: ImagePicker.ImagePickerAsset[]): Promise<StagedImage[]> {
  const out: StagedImage[] = [];
  for (const a of assets) {
    try {
      out.push(
        await normalize({
          uri: a.uri,
          base64: a.base64 ?? undefined,
          mime: a.mimeType ?? undefined,
          width: a.width,
          height: a.height,
        }),
      );
    } catch {
      // One bad asset must not lose the others the student picked alongside it.
      failed();
    }
  }
  return out;
}

/** The staged form the composer holds → the record kept on the optimistic message
 *  (bytes dropped; the thumbnail renders from the local file). */
export function toChatImage(s: StagedImage): ChatImage {
  return { kind: "image", uri: s.uri, mime: s.mime, width: s.width, height: s.height };
}

/** The wire form: what POST /api/chat/stream expects in `attachments`. */
export function toAttachment(s: StagedImage) {
  return { base64: s.base64, mime: s.mime, width: s.width, height: s.height };
}
