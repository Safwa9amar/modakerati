// Marks the pagination plugin's OWN writes. Removing and re-inserting boundary
// nodes is a dirty update like any other, so without a tag to recognise it by,
// the plugin's update listener would re-trigger the plugin — forever, every
// 400ms, for as long as the document stayed open. That is not merely wasted
// work: the native side resets its 1500ms serialize timer on every editor
// report, so a self-feeding loop would hold that timer permanently reset and the
// student's writing would never be saved.
//
// ⚠️ The `tags.has(PAGES_TAG)` early-return in the plugin's update listener is
// what stops that loop. Move the two together or not at all.
export const PAGES_TAG = "page-view";
