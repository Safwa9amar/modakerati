// components/workspace/ribbon/ribbon-icons.tsx
import type { LucideIcon } from "lucide-react-native";
import {
  Scaling, RotateCw, FileText, Columns3, SeparatorHorizontal, ListOrdered,
  IndentIncrease, MoveVertical, Sparkles, Type, Palette, PaintBucket, Square,
  Droplets, Table, ImagePlus, ChartBar, Shapes, TextCursorInput, PanelTop,
  PanelBottom, Hash, Superscript, Sigma, SquareSplitVertical, ListTree, RefreshCw,
  StickyNote, BookMarked, Quote, BookText, Tag, Images, CornerDownRight,
  ChevronUp, ChevronDown, Rows3, TableProperties, Heading,
} from "lucide-react-native";
import { RIBBON_ICON_KEYS } from "./ribbon-config";

/** icon key (from ribbon-config) → lucide component. Keep in sync with RIBBON_ICON_KEYS. */
export const RIBBON_ICONS: Record<string, LucideIcon> = {
  margins: Scaling,
  orientation: RotateCw,
  size: FileText,
  columns: Columns3,
  breaks: SeparatorHorizontal,
  lineNumbers: ListOrdered,
  indent: IndentIncrease,
  spacing: MoveVertical,
  thesisReady: Sparkles,
  fonts: Type,
  themes: Palette,
  pageColor: PaintBucket,
  pageBorders: Square,
  watermark: Droplets,
  table: Table,
  picture: ImagePlus,
  chart: ChartBar,
  shapes: Shapes,
  textBox: TextCursorInput,
  header: PanelTop,
  footer: PanelBottom,
  pageNumber: Hash,
  footnote: Superscript,
  symbol: Sigma,
  pageBreak: SquareSplitVertical,
  toc: ListTree,
  updateToc: RefreshCw,
  endnote: StickyNote,
  citation: BookMarked,
  citationStyle: Quote,
  bibliography: BookText,
  caption: Tag,
  figuresList: Images,
  crossRef: CornerDownRight,
  promote: ChevronUp,
  demote: ChevronDown,
  insertRow: Rows3,
  insertCol: TableProperties,
  headerRow: Heading,
};

if (__DEV__) {
  const missing = RIBBON_ICON_KEYS.filter((k) => !RIBBON_ICONS[k]);
  if (missing.length) throw new Error(`ribbon-icons: missing icons for ${missing.join(", ")}`);
}
