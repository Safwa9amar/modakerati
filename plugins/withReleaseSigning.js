const { withAppBuildGradle } = require("expo/config-plugins");

// android/ is gitignored (Continuous Native Generation), so any hand-edit to
// app/build.gradle is destroyed by the next `expo prebuild`. Release signing has
// to be reapplied as a mod instead — otherwise a rebuild silently reverts to the
// debug keystore and ships an APK that Play will reject and that no longer
// matches the installed app's signature.
//
// Credentials are NOT stored here or anywhere in the repo. Gradle reads them
// from ~/.gradle/gradle.properties:
//   MODAKERATI_UPLOAD_STORE_FILE, _STORE_PASSWORD, _KEY_ALIAS, _KEY_PASSWORD
// A machine without them still builds — it just falls back to debug signing.

const SIGNING_CONFIG = `
        release {
            if (project.hasProperty('MODAKERATI_UPLOAD_STORE_FILE')) {
                storeFile file(MODAKERATI_UPLOAD_STORE_FILE)
                storePassword MODAKERATI_UPLOAD_STORE_PASSWORD
                keyAlias MODAKERATI_UPLOAD_KEY_ALIAS
                keyPassword MODAKERATI_UPLOAD_KEY_PASSWORD
            }
        }`;

const RELEASE_SIGNING_CONFIG_LINE =
  "            signingConfig project.hasProperty('MODAKERATI_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug";

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    if (src.includes("MODAKERATI_UPLOAD_STORE_FILE")) return cfg; // already applied

    // 1. Add a `release` entry to signingConfigs, right after the debug one.
    const debugSigningBlock = `        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }`;
    if (!src.includes(debugSigningBlock)) {
      throw new Error(
        "withReleaseSigning: could not find the debug signingConfig block in app/build.gradle. " +
          "The React Native template changed — update this plugin rather than letting the " +
          "release build silently fall back to the debug keystore."
      );
    }
    src = src.replace(debugSigningBlock, debugSigningBlock + SIGNING_CONFIG);

    // 2. Point buildTypes.release at it. Anchored on the template's own comment
    //    because `signingConfig signingConfigs.debug` also appears in the debug
    //    build type, and replacing that one would break debug builds.
    const releaseDefault = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
    if (!src.includes(releaseDefault)) {
      throw new Error(
        "withReleaseSigning: could not find the release buildType's default signingConfig in " +
          "app/build.gradle. Refusing to continue — a silent fallback here would produce a " +
          "debug-signed 'release' APK."
      );
    }
    src = src.replace(releaseDefault, RELEASE_SIGNING_CONFIG_LINE);

    cfg.modResults.contents = src;
    return cfg;
  });
};
