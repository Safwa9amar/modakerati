import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../ThemeProvider';
import { useTranslation } from '@/localization/i18nProvider';
import { Check } from 'lucide-react-native';

export default function TimelineItem({
  icon,
  title,
  description,
  buttonLabel,
  onButtonPress,
  showLine = false,
  active = false,
  children,
}) {
  const { isRTL } = useTranslation();

  const theme = useTheme();
  const [height, setHeight] = React.useState(0);
  const styles = getStyles(theme, isRTL, active, height);

  return (
    <>
      <View
        style={[styles.stepContainer, !active && styles.disabledContainer]}
        pointerEvents={active ? 'auto' : 'none'}
      >
        <View style={styles.timelineRow}>
          <View style={styles.iconCircle}>{icon}</View>
          {showLine && <View style={styles.line} />}
          {buttonLabel && (
            <TouchableOpacity
              style={styles.btn}
              onPress={onButtonPress}
              disabled={!active}
              activeOpacity={active ? 0.7 : 1}
            >
              <Check size={20} color={theme.colors.white} />
            </TouchableOpacity>
          )}
        </View>
        <View
          style={styles.textBlock}
          onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        >
          <Text style={styles.stepTitle}>{title}</Text>
          <Text style={styles.stepDesc}>{description}</Text>
          {children}
        </View>
      </View>
    </>
  );
}

function getStyles(theme, isRTL, active = true, height = 0) {
  const flexDirection = isRTL ? 'row-reverse' : 'row';
  const alignItemsText = isRTL ? 'flex-end' : 'flex-start';
  const textAlign = isRTL ? 'right' : 'left';
  const alignSelfBtn = isRTL ? 'flex-end' : 'flex-start';
  return StyleSheet.create({
    stepContainer: {
      flexDirection,
      alignItems: 'flex-start',
      marginBottom: theme.spacing['8'],
    },
    timelineRow: {
      alignItems: 'center',
      ...(isRTL
        ? { marginLeft: theme.spacing['4'], marginRight: 0 }
        : { marginRight: theme.spacing['4'], marginLeft: 0 }),
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      borderWidth: 4,
      borderColor: theme.colors.primary[500],
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: theme.spacing['1'],
      elevation: 2,
      shadowColor: theme.colors.primary[500],
      shadowOpacity: 0.1,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      backgroundColor: theme.colors.white,
    },
    line: {
      width: 2,
      height: height || 48,
      backgroundColor: theme.colors.primary[400],
      alignSelf: 'center',
    },
    textBlock: {
      flex: 1,
      alignItems: alignItemsText,
    },
    stepTitle: {
      theme,
      fontSize: theme.typography.fontSizes.lg,
      fontWeight: 'bold',
      color: theme.colors.gray[900],
      marginBottom: theme.spacing['1'],
      textAlign,
    },
    stepDesc: {
      fontSize: theme.typography.fontSizes.md,
      color: theme.colors.gray[700],
      marginBottom: theme.spacing['2'],
      textAlign,
      lineHeight: 22,
    },
    btn: {
      backgroundColor: active
        ? theme.colors.primary[700]
        : theme.colors.gray[300],
      borderRadius: theme.radius.full,
      padding: theme.spacing['2'],
      alignSelf: "center",
      marginTop: theme.spacing['1'],
      shadowColor: active ? theme.colors.primary[900] : theme.colors.gray[400],
      shadowOpacity: 0.18,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
      opacity: active ? 1 : 0.6,
    },
    btnText: {
      color: active ? theme.colors.primary[50] : theme.colors.gray[500],
      fontWeight: 'bold',
      fontSize: theme.typography.fontSizes.sm,
      letterSpacing: 0.5,
      textShadowColor: active
        ? theme.colors.primary[900]
        : theme.colors.gray[400],
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 2,
    },
    disabledContainer: {
      opacity: 0.5,
    },
  });
}
