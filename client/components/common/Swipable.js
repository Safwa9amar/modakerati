import React from 'react';
import { View, StyleSheet } from 'react-native';
import SwipeableItem, { UnderlayParams } from 'react-native-swipeable-item';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: 6,
  },
  underlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 10,
    borderRadius: 10,
  },
});

export default function Swipable({
  children,
  leftAction,
  rightAction,
  leftActionContent,
  rightActionContent,
  style,
}) {
  // Underlay renderers
  const renderUnderlayLeft = () => (
    <View style={[styles.underlay, { backgroundColor: '#10B981' }]}> {leftActionContent} </View>
  );
  const renderUnderlayRight = () => (
    <View style={[styles.underlay, { backgroundColor: '#EF4444' }]}> {rightActionContent} </View>
  );

  return (
    <GestureHandlerRootView style={styles.container}>
        <SwipeableItem
          key={children?.key || undefined}
          item={children?.key || 'item'}
          renderUnderlayLeft={leftActionContent ? renderUnderlayLeft : undefined}
          renderUnderlayRight={rightActionContent ? renderUnderlayRight : undefined}
          snapPointsLeft={leftAction ? [40] : []}
          snapPointsRight={rightAction ? [40] : []}
          onChange={({ openDirection }) => {
            if (openDirection === 'left' && leftAction) leftAction();
            if (openDirection === 'right' && rightAction) rightAction();
          }}
        >
          {children}
        </SwipeableItem>
    </GestureHandlerRootView>
  );
}
