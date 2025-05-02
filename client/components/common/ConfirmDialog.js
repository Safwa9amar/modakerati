import React from 'react';
import { Dialog, Portal, Button, Text } from 'react-native-paper';

export default function ConfirmDialog({
  visible,
  onDismiss,
  onConfirm,
  title,
  message,
  confirmLabel = 'Done',
  cancelLabel = 'Cancel',
  isRTL = false,
}) {
  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss}>
        <Dialog.Title
          style={{
            fontSize: 22,
            fontWeight: 'bold',
            color: '#3B82F6',
            textAlign: isRTL ? 'right' : 'left',
            letterSpacing: 1,
          }}
        >
          {title}
        </Dialog.Title>
        <Dialog.Content>
          <Text
            style={{ textAlign: isRTL ? 'right' : 'left' }}
            variant="bodyMedium"
          >
            {message}
          </Text>
        </Dialog.Content>
        <Dialog.Actions style={{ alignSelf: isRTL ? 'flex-end' : 'flex-start' }}>
          <Button onPress={onDismiss}>{cancelLabel}</Button>
          <Button onPress={onConfirm}>{confirmLabel}</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
