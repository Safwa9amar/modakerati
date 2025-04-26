import { View, Text, StyleSheet } from 'react-native';
import { createThemedStyles, useTheme } from '../ThemeProvider';

export default function Card({
  title,
  subtitle,
  children,
  footer,
  style,
  contentStyle
}) {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={[styles.card, style]}>
      {(title || subtitle) && (
        <View style={styles.header}>
          {title && <Text style={styles.title}>{title}</Text>}

          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

        </View>
      )}

      <View style={[styles.content, contentStyle]}>
        {children}
      </View>

      {footer && (
        <View style={styles.footer}>
          {footer}
        </View>
      )}
    </View>
  );
}

const useStyles = createThemedStyles((theme) => ({
  card: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.lg,
    shadowColor: theme.colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    margin: theme.spacing[2],
    overflow: 'hidden',
  },
  header: {
    padding: theme.spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[200],
  },
  title: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  subtitle: {
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.gray[600],
    marginTop: theme.spacing[1],
  },
  content: {
    padding: theme.spacing[4],
  },
  footer: {
    padding: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.gray[200],
    backgroundColor: theme.colors.gray[50],
  },
}));