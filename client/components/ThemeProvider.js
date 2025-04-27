import { createContext, useContext, useState } from 'react';
import { StyleSheet } from 'react-native';

const ThemeContext = createContext(null);

// Color palette
const colors = {
  primary: {
    50: '#EFF6FF',
    100: '#DBEAFE',
    200: '#BFDBFE',
    300: '#93C5FD',
    400: '#60A5FA',
    500: '#3B82F6',
    600: '#2563EB',
    700: '#1D4ED8',
    800: '#1E40AF',
    900: '#1E3A8A',
  },
  secondary: {
    50: '#F5F3FF',
    100: '#EDE9FE',
    200: '#DDD6FE',
    300: '#C4B5FD',
    400: '#A78BFA',
    500: '#8B5CF6',
    600: '#7C3AED',
    700: '#6D28D9',
    800: '#5B21B6',
    900: '#4C1D95',
  },
  accent: {
    50: '#F0FDFA',
    100: '#CCFBF1',
    200: '#99F6E4',
    300: '#5EEAD4',
    400: '#2DD4BF',
    500: '#14B8A6',
    600: '#0D9488',
    700: '#0F766E',
    800: '#115E59',
    900: '#134E4A',
  },
  success: {
    500: '#10B981',
    600: '#059669',
  },
  warning: {
    500: '#F59E0B',
    600: '#D97706',
  },
  error: {
    500: '#EF4444',
    600: '#DC2626',
  },
  gray: {
    50: '#F9FAFB',
    100: '#F3F4F6',
    200: '#E5E7EB',
    300: '#D1D5DB',
    400: '#9CA3AF',
    500: '#6B7280',
    600: '#4B5563',
    700: '#374151',
    800: '#1F2937',
    900: '#111827',
  },
  white: '#FFFFFF',
  black: '#000000',
  transparent: 'transparent',
};

// Light and dark color palettes
const lightColors = {
  ...colors,
  background: {
    main: '#F9FAFB',
    secondary: '#E5E7EB',
  },
  text: {
    main: '#111827',
    secondary: '#6B7280',
  },
};

const darkColors = {
  ...colors,
  background: {
    main: '#18181b', // much darker for dark mode
    secondary: '#27272a',
  },
  text: {
    main: '#F9FAFB', // light text for dark bg
    secondary: '#A1A1AA',
  },
  gray: {
    50: '#18181b',
    100: '#27272a',
    200: '#3f3f46',
    300: '#52525b',
    400: '#71717a',
    500: '#a1a1aa',
    600: '#d4d4d8',
    700: '#e4e4e7',
    800: '#f4f4f5',
    900: '#fafafa',
  },
  white: '#18181b',
  black: '#fafafa',
};

// Font sizes with 8px spacing system
const typography = {
  fontSizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    '2xl': 24,
    '3xl': 30,
    '4xl': 36,
  },
  lineHeights: {
    tight: 1.2,    // 120% - for headings
    base: 1.5,     // 150% - for body text
    relaxed: 1.75, // 175% - for larger text blocks
  },
  fontWeights: {
    normal: '400',
    medium: '500',
    bold: '700',
  },
};

// Spacing with 8px system
const spacing = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
  '20': 80,
  '24': 96,
};

// Border radius
const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
};

export function ThemeProvider({ children }) {
  const [isRTL, setIsRTL] = useState(false);
  const [mode, setMode] = useState('light'); // 'light' or 'dark'

  const theme = {
    colors: mode === 'dark' ? darkColors : lightColors,
    typography,
    spacing,
    radius,
    isRTL,
    setIsRTL,
    mode,
    setMode,
    toggleMode: () => setMode((prev) => (prev === 'light' ? 'dark' : 'light')),
  };

  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);

// Helper function to create themed stylesheets
export const createThemedStyles = (styleCreator) => {
  return () => {
    const theme = useTheme();
    return StyleSheet.create(styleCreator(theme));
  };
};