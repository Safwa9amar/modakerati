import React from 'react';
import {  StyleSheet } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { TextInput } from 'react-native-paper';

export default function ThemedTextInput({ style, ...props }) {
  const theme = useTheme();
  
  return (
    <TextInput
      style={[
        {
          backgroundColor: theme.colors.white,
          color: theme.colors.text.main,
          borderColor: theme.colors.primary[400],
        },
        style,
      ]}
      placeholderTextColor={theme.colors.gray[400]}
      {...props}
    />
  );
}
