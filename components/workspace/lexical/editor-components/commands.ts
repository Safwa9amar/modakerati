// Lexical commands shared by MORE THAN ONE plugin. A plugin-private command stays
// in its own file; this module exists so that two plugins on opposite ends of the
// dispatch never have to import each other (which is how an import cycle — and a
// silently undefined command at module init — gets in).

import { createCommand, type LexicalCommand as LxCommand } from "lexical";
import type { InsertBlockPayload } from "./types";

// The Notion-style Insert menu. EditorBridge dispatches it when native answers the
// "/query" trigger; SlashPlugin handles it (it owns the /query text to remove).
export const INSERT_BLOCK_COMMAND: LxCommand<InsertBlockPayload> = createCommand("INSERT_BLOCK_COMMAND");
