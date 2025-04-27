import { Pressable, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../ThemeProvider';

export default function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  disabled = false,
  leftIcon = null,
  rightIcon = null,
  style,
  textStyle,
}) {
  const theme = useTheme();

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: theme.colors.primary[600],
          textColor: theme.colors.white,
        };
      case 'secondary':
        return {
          backgroundColor: theme.colors.secondary[600],
          textColor: theme.colors.white,
        };
      case 'outline':
        return {
          backgroundColor: theme.colors.transparent,
          borderColor: theme.colors.primary[600],
          borderWidth: 1,
          textColor: theme.colors.primary[600],
        };
      case 'ghost':
        return {
          backgroundColor: theme.colors.transparent,
          textColor: theme.colors.primary[600],
        };
      default:
        return {
          backgroundColor: theme.colors.primary[600],
          textColor: theme.colors.white,
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingHorizontal: theme.spacing[3],
          paddingVertical: theme.spacing[2],
          fontSize: theme.typography.fontSizes.sm,
        };
      case 'md':
        return {
          paddingHorizontal: theme.spacing[4],
          paddingVertical: theme.spacing[3],
          fontSize: theme.typography.fontSizes.md,
        };
      case 'lg':
        return {
          paddingHorizontal: theme.spacing[6],
          paddingVertical: theme.spacing[4],
          fontSize: theme.typography.fontSizes.lg,
        };
      default:
        return {
          paddingHorizontal: theme.spacing[4],
          paddingVertical: theme.spacing[3],
          fontSize: theme.typography.fontSizes.md,
        };
    }
  };

  const variantStyle = getVariantStyles();
  const sizeStyle = getSizeStyles();

  const buttonStyles = [
    styles.button,
    {
      backgroundColor: variantStyle.backgroundColor,
      borderColor: variantStyle.borderColor,
      borderWidth: variantStyle.borderWidth,
      paddingHorizontal: sizeStyle.paddingHorizontal,
      paddingVertical: sizeStyle.paddingVertical,
      opacity: disabled ? 0.6 : 1,
      flexDirection: theme.isRTL ? 'row-reverse' : 'row',
      borderRadius: theme.radius.md,
    },
    style,
  ];

  const textStyles = [
    styles.text,
    {
      color: variantStyle.textColor,
      fontSize: sizeStyle.fontSize,
      fontWeight: theme.typography.fontWeights.medium,
      textAlign: 'center',
    },
    textStyle,
  ];

  return (
    <Pressable
      style={buttonStyles}
      onPress={onPress}
      disabled={isLoading || disabled}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={variantStyle.textColor} />
      ) : (
        <>
          {leftIcon && <Text style={{ marginRight: theme.spacing[2] }}>{leftIcon}</Text>}

          <Text style={textStyles}>{title}</Text>
          {rightIcon && <Text style={{ marginLeft: theme.spacing[2] }}>{rightIcon}</Text>}

        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  text: {
    textAlign: 'center',
  },
});