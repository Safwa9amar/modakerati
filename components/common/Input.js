import { TextInput, View, Text, StyleSheet } from 'react-native';
import { createThemedStyles, useTheme } from '../ThemeProvider';

export default function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  leftIcon,
  rightIcon,
  secureTextEntry,
  multiline,
  numberOfLines,
  style,
  inputStyle,
  ...props
}) {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={[styles.container, style]}>
      {label && <Text style={styles.label}>{label}</Text>}


      <View style={[
        styles.inputContainer,
        error && styles.inputError,
      ]}>
        {leftIcon && <View style={styles.iconLeft}>{leftIcon}</View>}


        <TextInput
          style={[
            styles.input,
            leftIcon && styles.inputWithLeftIcon,
            rightIcon && styles.inputWithRightIcon,
            multiline && styles.multiline,
            inputStyle,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          secureTextEntry={secureTextEntry}
          multiline={multiline}
          numberOfLines={numberOfLines}
          textAlign={theme.isRTL ? 'right' : 'left'}
          {...props}
        />

        {rightIcon && <View style={styles.iconRight}>{rightIcon}</View>}

      </View>

      {error && <Text style={styles.errorText}>{error}</Text>}

    </View>
  );
}

const useStyles = createThemedStyles((theme) => ({
  container: {
    marginBottom: theme.spacing[4],
  },
  label: {
    fontSize: theme.typography.fontSizes.sm,
    marginBottom: theme.spacing[1],
    fontWeight: theme.typography.fontWeights.medium,
    color: theme.colors.gray[700],
  },
  inputContainer: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.gray[300],
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.white,
  },
  input: {
    flex: 1,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    fontSize: theme.typography.fontSizes.md,
    color: theme.colors.gray[900],
  },
  inputWithLeftIcon: {
    paddingLeft: 0,
  },
  inputWithRightIcon: {
    paddingRight: 0,
  },
  inputError: {
    borderColor: theme.colors.error[500],
  },
  multiline: {
    textAlignVertical: 'top',
    minHeight: 100,
  },
  iconLeft: {
    paddingLeft: theme.spacing[3],
  },
  iconRight: {
    paddingRight: theme.spacing[3],
  },
  errorText: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.error[500],
    marginTop: theme.spacing[1],
  },
}));