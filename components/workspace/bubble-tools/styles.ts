import { StyleSheet } from "react-native";

/** Every tool chip is a CHIP×CHIP square — the unit the pill, the column strip and
 *  FloatingPill's drag host are all sized from. */
export const CHIP = 40;

/** The look shared by every bubble toolbar: tool chips, group dividers and the
 *  option pills inside a sub-panel. Layout (row vs column, scrolling, the pill
 *  surface itself) belongs to the shell — BlockContextBar — not here. */
export const toolStyles = StyleSheet.create({
  chip: {
    width: CHIP,
    height: CHIP,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  chipDim: { opacity: 0.4 },
  /** Divider between tool groups — a hairline ACROSS the flow direction, so the
   *  column form uses `sepV` instead. */
  sep: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 2 },
  sepV: { height: StyleSheet.hairlineWidth, width: 22, marginVertical: 2 },

  optPill: {
    minWidth: 42,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  /** The same option inside the ONE-chip-wide COLUMN fly-out, where the roomy pill
   *  does not fit: it spends 24pt of its 42pt minimum on side padding, leaving under
   *  19pt of text box — enough for "H1", not for "H2", which wrapped to a second line
   *  that the fixed 34pt height then clipped. Here it takes the tool chip's square
   *  footprint instead, so a two-glyph label has the full 40pt to sit on. */
  optPillNarrow: { minWidth: CHIP, width: CHIP, height: CHIP, paddingHorizontal: 0, borderRadius: 12 },
  optText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  swatch: { width: 18, height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth },
  soonCaption: { fontSize: 11, fontFamily: "Inter_500Medium", alignSelf: "center", marginLeft: 6 },
});
