// A tapped equation → the native equation sheet.

import { useEffect } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW } from "lexical";
import { $equationTarget, EQUATION_EDIT_COMMAND } from "../../blockLexical";

/**
 * A tapped equation → the native equation editor.
 *
 * The command carries only the node key, because that is all a decorator knows;
 * resolving it to a BLOCK INDEX has to happen here, where the whole tree is
 * readable. The payload crosses to native as a JSON string — DOM component props
 * are serializable only.
 */
export function EquationTapPlugin({ onEquationTap }: { onEquationTap?: (payload: string) => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        EQUATION_EDIT_COMMAND,
        (nodeKey: string) => {
          const target = editor.getEditorState().read(() => $equationTarget(nodeKey));
          if (target) onEquationTap?.(JSON.stringify(target));
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onEquationTap],
  );
  return null;
}
