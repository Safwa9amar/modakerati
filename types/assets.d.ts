// Ambient module declarations for binary assets Metro resolves via `require()`.
// On the "web" bundle target (which 'use dom' components compile to — see
// LexicalDomEditor.tsx) an asset require resolves to a URL string; on the
// native ios/android targets it resolves to a numeric asset id. Both are
// handled at call sites, so the type stays a union.
declare module "*.ttf" {
  const src: string | number;
  export default src;
}
