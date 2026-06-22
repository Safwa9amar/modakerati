import { registerWebModule, NativeModule } from 'expo';

import { ModakeratiBubbleModuleEvents } from './ModakeratiBubble.types';

// No system overlay on web — every method is a no-op / negative.
class ModakeratiBubbleModule extends NativeModule<ModakeratiBubbleModuleEvents> {
  isSupported() {
    return false;
  }
  hasOverlayPermission() {
    return false;
  }
  async requestOverlayPermission() {
    return false;
  }
  setEnabled(_enabled: boolean) {}
  isShowing() {
    return false;
  }
  async show() {
    return false;
  }
  async hide() {}
}

export default registerWebModule(ModakeratiBubbleModule, 'ModakeratiBubbleModule');
