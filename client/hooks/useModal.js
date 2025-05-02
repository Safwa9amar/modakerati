import React, { useState, useCallback } from 'react';
import { Modal, Portal } from 'react-native-paper';

/**
 * Custom hook to control a modal with children content.
 * Usage:
 * const { ModalWrapper, showModal, hideModal, visible } = useModal();
 * <ModalWrapper><YourContent /></ModalWrapper>
 */
export function useModal({ containerStyle = {} } = {}) {
  const [visible, setVisible] = useState(false);
  const showModal = useCallback(() => setVisible(true), []);
  const hideModal = useCallback(() => setVisible(false), []);
  
  // ModalWrapper component to render children inside the modal
  const ModalWrapper = useCallback(
    ({ children }) => (
      <Portal>
        <Modal
          visible={visible}
          onDismiss={hideModal}
          contentContainerStyle={[
            { backgroundColor: 'white', padding: 20, borderRadius: 12 },
            containerStyle,
          ]}
        >
          {children}
        </Modal>
      </Portal>
    ),
    [visible, hideModal, containerStyle]
  );

  return { ModalWrapper, showModal, hideModal, visible };
}
