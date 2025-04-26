import { View, Text, Pressable, StyleSheet } from 'react-native';
import { File, X } from 'lucide-react-native';
import { createThemedStyles, useTheme } from '../ThemeProvider';

export default function DocumentCard({ document, onRemove, onPress }) {
  const styles = useStyles();
  const theme = useTheme();
  
  // Format file size
  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown size';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  };
  
  return (
    <Pressable 
      style={styles.card}
      onPress={onPress}
    >
      <View style={styles.iconContainer}>
        <File color={theme.colors.primary[600]} size={24} />
      </View>
      
      <View style={styles.content}>
        <Text style={styles.filename} numberOfLines={1}>{document.name}</Text>
        <Text style={styles.fileInfo}>{formatFileSize(document.size)}</Text>
      </View>
      
      {onRemove && (
        <Pressable 
          style={styles.removeButton}
          onPress={() => onRemove(document.id)}
          hitSlop={8}
        >
          <X size={18} color={theme.colors.gray[500]} />
        </Pressable>
      )}
    </Pressable>
  );
}

const useStyles = createThemedStyles((theme) => ({
  card: {
    flexDirection: theme.isRTL ? 'row-reverse' : 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  iconContainer: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.radius.md,
    marginRight: theme.isRTL ? 0 : theme.spacing[3],
    marginLeft: theme.isRTL ? theme.spacing[3] : 0,
  },
  content: {
    flex: 1,
  },
  filename: {
    fontSize: theme.typography.fontSizes.md,
    fontWeight: theme.typography.fontWeights.medium,
    color: theme.colors.gray[900],
    marginBottom: 2,
  },
  fileInfo: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.gray[500],
  },
  removeButton: {
    padding: theme.spacing[2],
  },
}));