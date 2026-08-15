// Block-editing keyboard mode — whether a tap opens the OS keyboard.

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

// Block-editing keyboard mode: when inactive, set inputmode="none" on the editor root
// so a tap still focuses + selects a block (the bubble tools show) but the OS keyboard
// stays CLOSED — no focus/blur fight. Active → inputmode="text" so a tap or an explicit
// focus command brings the keyboard up. The RN TextInputs in the bubble/pills are
// separate elements, so this never affects the AI Ask input. (Issue #6.)
export function KeyboardModePlugin({ active }: { active: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const apply = () => {
      const root = editor.getRootElement();
      if (root) root.setAttribute("inputmode", active ? "text" : "none");
    };
    apply();
    return editor.registerRootListener(apply);
  }, [editor, active]);
  return null;
}
