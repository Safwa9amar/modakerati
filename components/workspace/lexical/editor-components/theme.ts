// Lexical maps active formats to THESE class names; ./styles styles them.
// Passed to LexicalComposer's initialConfig — a class renamed here without a
// matching rename in ./styles silently drops the styling, not the formatting.

export const theme = {
  paragraph: "lx-p",
  heading: { h1: "lx-h1", h2: "lx-h2", h3: "lx-h3" },
  quote: "lx-quote",
  list: { ul: "lx-ul", ol: "lx-ol", listitem: "lx-li", listitemChecked: "lx-li-checked", listitemUnchecked: "lx-li-unchecked" },
  text: { bold: "lx-bold", italic: "lx-italic", underline: "lx-underline" },
};
