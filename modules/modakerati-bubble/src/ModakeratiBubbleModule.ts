import { NativeModule, requireNativeModule } from 'expo';

import { ModakeratiBubbleModuleEvents } from './ModakeratiBubble.types';

declare class ModakeratiBubbleModule extends NativeModule<ModakeratiBubbleModuleEvents> {
  /** True only where a system overlay is possible (Android). */
  isSupported(): boolean;
  /** Whether the "display over other apps" permission is currently granted. */
  hasOverlayPermission(): boolean;
  /** Open the system permission screen. Resolves with the current (often still
   *  false) state — re-check `hasOverlayPermission()` after the app resumes. */
  requestOverlayPermission(): Promise<boolean>;
  /** Enable the feature: while enabled, the bubble shows whenever the app is
   *  backgrounded and is removed when it returns. Disabling removes it now. */
  setEnabled(enabled: boolean): void;
  isShowing(): boolean;
  /** Manually show the bubble now (returns false without permission). */
  show(): Promise<boolean>;
  /** Manually remove the bubble now. */
  hide(): Promise<void>;
}

export default requireNativeModule<ModakeratiBubbleModule>('ModakeratiBubble');
