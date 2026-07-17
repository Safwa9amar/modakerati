import { View, Text, StyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { getTextDirection } from "@/lib/text-direction";
import { ribbonDrop, pageEdgeThickness } from "@/lib/thesis-book";
import { useCoverParallax } from "./useCoverParallax";

const RIBBON_COLOR = "#2FCF9E";

/**
 * The animated faux-3D thesis "book". Brand-indigo cover with a bookmark
 * ribbon whose drop length encodes progress. Tilts on drag and phone motion
 * (see useCoverParallax). Title renders in its own script direction.
 */
export function ThesisBookCover({
  title,
  progress,
  wordCount,
  resumeHint,
}: {
  title: string;
  progress: number;
  wordCount: number;
  resumeHint: string;
}) {
  const { animatedStyle, panGesture } = useCoverParallax();
  const isRtl = getTextDirection(title) === "rtl";
  const drop = ribbonDrop(progress);
  const edge = pageEdgeThickness(wordCount);

  return (
    <View style={styles.stage}>
      <View style={styles.floorGlow} />
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.book, animatedStyle]}>
          <View style={[styles.pageEdges, { width: edge }]} />

          <LinearGradient
            colors={["#6675FF", "#3B2F8F"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cover}
          >
            <View style={styles.sheen} />
            <View style={styles.spineShadow} />

            <Text style={styles.kicker}>THESIS</Text>
            <Text
              style={[
                styles.title,
                { textAlign: isRtl ? "right" : "left", writingDirection: isRtl ? "rtl" : "ltr" },
              ]}
              numberOfLines={4}
            >
              {title}
            </Text>
            <Text style={[styles.hint, { textAlign: isRtl ? "right" : "left" }]} numberOfLines={1}>
              📗 {Math.round(progress)}% · {resumeHint}
            </Text>
          </LinearGradient>

          {/* ribbon (on top of the cover, not clipped) */}
          <View style={[styles.ribbon, { height: drop }]} />
          <View style={[styles.ribbonNotch, { top: drop - 4 }]} />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const COVER_W = 150;
const COVER_H = 208;

const styles = StyleSheet.create({
  stage: { height: 236, alignItems: "center", justifyContent: "center" },
  floorGlow: {
    position: "absolute",
    bottom: 14,
    width: 150,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#5C6BFF",
    opacity: 0.28,
  },
  book: { width: COVER_W, height: COVER_H },
  pageEdges: {
    position: "absolute",
    right: -8,
    top: 6,
    height: COVER_H - 12,
    backgroundColor: "#E9E9F2",
    borderRadius: 1,
  },
  cover: {
    width: COVER_W,
    height: COVER_H,
    borderRadius: 5,
    borderTopRightRadius: 11,
    borderBottomRightRadius: 11,
    padding: 16,
    justifyContent: "space-between",
    overflow: "hidden",
    shadowColor: "#5C6BFF",
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 20 },
    elevation: 12,
  },
  sheen: {
    position: "absolute",
    top: -40,
    right: -30,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  spineShadow: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 10,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  ribbon: {
    position: "absolute",
    top: -4,
    left: 28,
    width: 22,
    backgroundColor: RIBBON_COLOR,
  },
  ribbonNotch: {
    position: "absolute",
    left: 28,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderTopWidth: 10,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: RIBBON_COLOR,
  },
  kicker: {
    fontSize: 10,
    letterSpacing: 3,
    color: "rgba(255,255,255,0.72)",
    fontFamily: "Inter_600SemiBold",
    alignSelf: "flex-end",
  },
  title: { fontSize: 15, lineHeight: 21, color: "#FFFFFF", fontFamily: "Inter_700Bold" },
  hint: { fontSize: 10, color: "rgba(255,255,255,0.9)", fontFamily: "Inter_500Medium" },
});
