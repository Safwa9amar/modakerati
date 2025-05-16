import React from 'react';
import {  StyleSheet, Text } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { TextInput } from 'react-native-paper';

export default function ThemedTextInput({ style, ...props }) {
  const theme = useTheme();
  
  return (
    <>
    <TextInput
    textColor={theme.colors.text.main}

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
    {props.error && <Text style={{
      color: theme.colors.error[500],
      fontSize: 12,
      marginTop: 4,
    }}>{props.error}</Text>}
    </>
  );
}
