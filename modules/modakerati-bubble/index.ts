import { ModakeratiBubbleModuleEvents } from './src/ModakeratiBubble.types';

export * from './src/ModakeratiBubble.types';

export interface ModakeratiBubbleApi {
  isSupported(): boolean;
  hasOverlayPermission(): boolean;
  requestOverlayPermission(): Promise<boolean>;
  setEnabled(enabled: boolean): void;
  isShowing(): boolean;
  show(): Promise<boolean>;
  hide(): Promise<void>;
  addListener(
    eventName: keyof ModakeratiBubbleModuleEvents,
    listener: () => void,
  ): { remove: () => void };
  removeAllListeners(eventName: keyof ModakeratiBubbleModuleEvents): void;
}

// requireNativeModule (inside ./src/ModakeratiBubbleModule) throws if the native
// module isn't linked — e.g. running in Expo Go, or before the first dev build
// after adding this module. Fall back to a no-op so the JS still runs everywhere;
// callers gate real behavior on `isSupported()` anyway.
let native: ModakeratiBubbleApi | null = null;
try {
  native = require('./src/ModakeratiBubbleModule').default as ModakeratiBubbleApi;
} catch {
  native = null;
}

const fallback = {
  isSupported: () => false,
  hasOverlayPermission: () => false,
  requestOverlayPermission: async () => false,
  setEnabled: () => {},
  isShowing: () => false,
  show: async () => false,
  hide: async () => {},
  addListener: () => ({ remove: () => {} }),
  removeAllListeners: () => {},
} as unknown as ModakeratiBubbleApi;

export default native ?? fallback;
