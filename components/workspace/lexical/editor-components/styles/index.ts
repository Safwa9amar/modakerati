// The editor's stylesheet, assembled from one chunk per feature.
//
// ⚠️ ORDER IS LOAD-BEARING. These are plain CSS rules in a single <style> tag, so
// a later chunk overrides an earlier one on equal specificity — ./motion's
// animations override ./suggestion's static rules, and so on. The array below is
// the SOURCE ORDER of the stylesheet this was split out of; reordering it is a
// visual change, not a tidy-up.
//
// Each chunk is written as `\n…rules…\n` so the file reads as a stylesheet; strip
// removes exactly the one newline each side that the formatting added — NOT a
// trim(), which would also eat a chunk's own trailing blank line. Joining the
// stripped chunks with a single newline reproduces the original literal byte for
// byte (that equivalence was verified against the pre-split file).

import { CSS_BASE } from "./base";
import { CSS_CHROME } from "./chrome";
import { CSS_EQUATIONS } from "./equations";
import { CSS_TABLES } from "./tables";
import { CSS_SEARCH } from "./search";
import { CSS_SUGGESTION } from "./suggestion";
import { CSS_MOTION } from "./motion";
import { CSS_REORDER } from "./reorder";
import { CSS_SELECT } from "./select";
import { CSS_PAGES } from "./pages";

const strip = (chunk: string) => chunk.replace(/^\n/, "").replace(/\n$/, "");

export const CSS = `\n${[
  CSS_BASE,
  CSS_CHROME,
  CSS_EQUATIONS,
  CSS_TABLES,
  CSS_SEARCH,
  CSS_SUGGESTION,
  CSS_MOTION,
  CSS_REORDER,
  CSS_SELECT,
  CSS_PAGES,
]
  .map(strip)
  .join("\n")}\n`;
