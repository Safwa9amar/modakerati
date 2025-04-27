import React from 'react';
import { View, Text } from 'react-native';

export default function Feedback() {
  return (
    <View style={{ padding: 20 }}>
      <Text style={{ fontSize: 24, marginBottom: 16 }}>Feedback</Text>
      <Text>Send us your feedback here.</Text>
    </View>
  );
}
