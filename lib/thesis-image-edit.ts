// On-device image manipulation for the workspace Picture tools (rotate / flip /
// crop). The source of truth is the figure inside the .docx on the server, so we
// download the block's current bytes, transform them locally with
// expo-image-manipulator, and hand the new PNG back to the caller to upload via
// replaceThesisBlockImage. Background removal is server-side (see api.removeThesisBlockBg).
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { thesisBlockImageUrl, getAuthHeader } from "@/lib/api";

export type RotateFlipOp = "rotateRight" | "rotateLeft" | "flipH" | "flipV";

export interface EditedImage {
  data: string; // base64 PNG (no data: prefix)
  format: "png";
  width?: number;
  height?: number;
}

/**
 * Download a figure block's current image bytes to a local cache file. Authed (the
 * media endpoint needs a Bearer token) and cache-busted with `t` so we always edit
 * the latest bytes, never a stale HTTP-cached copy. Returns the local file URI.
 */
export async function downloadBlockImage(thesisId: string, index: number): Promise<string> {
  const headers = await getAuthHeader();
  const url = thesisBlockImageUrl(thesisId, index, Date.now());
  const dest = `${FileSystem.cacheDirectory}fig-${index}-${Date.now()}`;
  const res = await FileSystem.downloadAsync(url, dest, { headers });
  if (res.status !== 200) throw new Error(`image download failed (${res.status})`);
  return res.uri;
}

async function toPng(ctx: ReturnType<typeof ImageManipulator.manipulate>): Promise<EditedImage> {
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ format: SaveFormat.PNG, base64: true });
  return { data: out.base64 ?? "", format: "png", width: out.width, height: out.height };
}

/** Download the block image, apply a rotate/flip, return PNG base64 + new size. */
export async function rotateFlipBlockImage(
  thesisId: string,
  index: number,
  op: RotateFlipOp,
): Promise<EditedImage> {
  const uri = await downloadBlockImage(thesisId, index);
  let ctx = ImageManipulator.manipulate(uri);
  if (op === "rotateRight") ctx = ctx.rotate(90);
  else if (op === "rotateLeft") ctx = ctx.rotate(-90);
  else if (op === "flipH") ctx = ctx.flip("horizontal");
  else ctx = ctx.flip("vertical");
  return toPng(ctx);
}

/**
 * Crop a local image to `rect` (pixels in the image's own coordinate space),
 * returning PNG base64 + the cropped size. Used by the crop modal, which already
 * has the downloaded local URI + the user's rectangle.
 */
export async function cropLocalImage(
  localUri: string,
  rect: { originX: number; originY: number; width: number; height: number },
): Promise<EditedImage> {
  return toPng(ImageManipulator.manipulate(localUri).crop(rect));
}
