import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import i18n from "@/lib/i18n";
import { useThesisDocStore } from "@/stores/thesis-doc-store";

// Single image-insert path used by both the block bubble (BlockContextBar's
// "Insert image" chip) and the Insert menu (Figure block). Opens the picker,
// reads base64, and fires the durable `insertImage` op after `afterIndex`.
// Body moved verbatim from BlockContextBar.tsx's old `pickImage` (~:453-477),
// parameterized on `thesisId`/`afterIndex` instead of the component's local
// `single` selection. The component-local `pickingRef` guard (which also
// covered `replaceImage`) is replaced here with a module-scoped guard so
// concurrent taps across ANY caller of this helper are still coalesced.
let picking = false;

export async function pickAndInsertImage(thesisId: string, afterIndex: number): Promise<void> {
  if (picking) return;
  picking = true;
  let res: ImagePicker.ImagePickerResult;
  try {
    res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], base64: true, quality: 0.7 });
  } catch {
    Alert.alert(i18n.t("workspace.imageError", { defaultValue: "Couldn't update the image." }));
    return;
  } finally {
    picking = false;
  }
  const asset = res.canceled ? null : res.assets[0];
  if (!asset?.base64) return;
  const mime = asset.mimeType ?? "";
  const format = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : "jpeg";
  void useThesisDocStore.getState().mutate(thesisId, {
    type: "insertImage",
    afterIndex,
    data: asset.base64,
    format,
    width: asset.width,
    height: asset.height,
  });
}
