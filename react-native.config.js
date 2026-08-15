// React Native autolinking derived the app's package as `com.kwill` — dropping the
// final segment of `com.kwill.app` — and generated
// ReactNativeApplicationEntryPoint.java referencing `com.kwill.BuildConfig`.
// AGP 8 removed the `package` attribute from AndroidManifest.xml, so the CLI has to
// infer the package, and it inferred it wrong; the real BuildConfig is emitted at
// `com.kwill.app.BuildConfig` (from the gradle `namespace`), so the build failed with
// "cannot find symbol: class BuildConfig, location: package com.kwill".
//
// Pinning it here is the supported override and keeps it correct across `expo
// prebuild --clean`, which regenerates android/ from scratch every time.
// Must stay in sync with `expo.android.package` in app.json.
module.exports = {
  project: {
    android: {
      packageName: 'com.kwill.app',
    },
  },
};
