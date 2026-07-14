import Svg, { Path, Rect, Circle, Text as SvgText } from "react-native-svg";

// Recognizable file-type / view icons for the workspace view switcher. lucide has
// no brand-accurate PDF/Word glyphs, so these are hand-authored: a white document
// page with a folded corner, plus a coloured format band (Adobe red "PDF",
// Word blue "W") or outline rows. Self-coloured, so they read the same on any
// header background; only `size` is configurable.

const PAGE = "M6 2.5 H14 L19 7.5 V20.5 A1 1 0 0 1 18 21.5 H6 A1 1 0 0 1 5 20.5 V3.5 A1 1 0 0 1 6 2.5 Z";
const FOLD = "M14 2.5 V7.5 H19 Z";

function Page({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PAGE} fill="#FFFFFF" stroke="#C9CCD6" strokeWidth={1} strokeLinejoin="round" />
      <Path d={FOLD} fill="#C9CCD6" />
      {children}
    </Svg>
  );
}

export function DocxIcon({ size = 22 }: { size?: number }) {
  return (
    <Page size={size}>
      <Rect x="6" y="13" width="12" height="6" rx="1" fill="#2B579A" />
      <SvgText x="12" y="17.8" fontSize="5.2" fontWeight="bold" fill="#FFFFFF" textAnchor="middle">
        W
      </SvgText>
    </Page>
  );
}

export function PdfIcon({ size = 22 }: { size?: number }) {
  return (
    <Page size={size}>
      <Rect x="6" y="13" width="12" height="6" rx="1" fill="#E5322D" />
      <SvgText x="12" y="17.7" fontSize="4.6" fontWeight="bold" fill="#FFFFFF" textAnchor="middle">
        PDF
      </SvgText>
    </Page>
  );
}

export function OutlineIcon({ size = 22 }: { size?: number }) {
  return (
    <Page size={size}>
      <Circle cx="8" cy="11.3" r="0.95" fill="#5B6270" />
      <Rect x="9.6" y="10.65" width="6.4" height="1.3" rx="0.65" fill="#5B6270" />
      <Circle cx="9.6" cy="14.6" r="0.85" fill="#9AA0AC" />
      <Rect x="11.1" y="14" width="4.9" height="1.2" rx="0.6" fill="#9AA0AC" />
      <Circle cx="9.6" cy="17.5" r="0.85" fill="#9AA0AC" />
      <Rect x="11.1" y="16.9" width="4.9" height="1.2" rx="0.6" fill="#9AA0AC" />
    </Page>
  );
}
