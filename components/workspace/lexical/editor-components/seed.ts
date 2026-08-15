// The editor's fallback initial state, used only when no `initialBlocks` arrive
// (the lab screens, and a thesis that has not loaded yet). Seeds a little
// bilingual content so RTL auto-detection is visible immediately.

import { $createHeadingNode } from "@lexical/rich-text";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";

export function seed(): void {
  const root = $getRoot();
  if (root.getFirstChild() !== null) return;
  const h = $createHeadingNode("h1");
  h.append($createTextNode("الفصل الأول: منهجية البحث"));
  const p1 = $createParagraphNode();
  p1.append($createTextNode("تُعدّ هذه الدراسة محاولةً لفهم أثر التحول الرقمي على جودة التعليم العالي."));
  const p2 = $createParagraphNode();
  p2.append($createTextNode("This mixed-language note flows left-to-right on its own — Lexical handles bidi."));
  root.append(h, p1, p2);
}
