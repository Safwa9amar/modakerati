import { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  Pressable,
  ViewToken,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MessageSquare, FileText, Download } from "lucide-react-native";
import { useThemeColors } from "@/hooks/useThemeColors";
import { Button } from "@/components/ui/Button";

const { width } = Dimensions.get("window");

interface Slide {
  key: string;
  icon: typeof MessageSquare;
  titleKey: string;
  descKey: string;
}

const slides: Slide[] = [
  {
    key: "1",
    icon: MessageSquare,
    titleKey: "onboarding.slide1Title",
    descKey: "onboarding.slide1Desc",
  },
  {
    key: "2",
    icon: FileText,
    titleKey: "onboarding.slide2Title",
    descKey: "onboarding.slide2Desc",
  },
  {
    key: "3",
    icon: Download,
    titleKey: "onboarding.slide3Title",
    descKey: "onboarding.slide3Desc",
  },
];

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = useCallback(() => {
    if (activeIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
    } else {
      router.push("/(auth)/language" as any);
    }
  }, [activeIndex, router]);

  const handleSkip = useCallback(() => {
    router.push("/(auth)/language" as any);
  }, [router]);

  const renderSlide = ({ item }: { item: Slide }) => {
    const Icon = item.icon;
    return (
      <View style={[styles.slide, { width }]}>
        <View style={[styles.iconCircle, { backgroundColor: colors.brandPrimary + "1A" }]}>
          <Icon size={64} color={colors.brandPrimary} strokeWidth={1.5} />
        </View>
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          {t(item.titleKey)}
        </Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          {t(item.descKey)}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: colors.bgPrimary }]}
    >
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      <View style={styles.dotsRow}>
        {slides.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor:
                  i === activeIndex ? colors.brandPrimary : colors.bgSurface,
                width: i === activeIndex ? 28 : 8,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <Button
          title={
            activeIndex === slides.length - 1
              ? t("common.continue")
              : t("common.next")
          }
          onPress={handleNext}
        />
        {activeIndex < slides.length - 1 && (
          <Pressable onPress={handleSkip} style={styles.skipButton}>
            <Text style={[styles.skipText, { color: colors.textSecondary }]}>
              {t("common.skip")}
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  title: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    marginBottom: 14,
  },
  description: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 24,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    gap: 16,
  },
  skipButton: {
    alignItems: "center",
    paddingVertical: 8,
  },
  skipText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
});
