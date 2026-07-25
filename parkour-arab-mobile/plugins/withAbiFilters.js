// ────────────────────────────────────────────────────────────────────────────
// Local Expo config plugin — restricts the Android build to arm64-v8a only.
//
// Why: without this, EAS builds a "universal" APK bundling native code for
// FOUR processor architectures (arm64-v8a, armeabi-v7a, x86, x86_64), even
// though 99% of real Android phones only need arm64-v8a. Every native
// module (Agora's voice engine especially, but also Reanimated/Worklets'
// CMake libs, Hermes, expo-gl, etc.) gets built and packaged 4x.
//
// v2 — the previous version of this file edited android/app/build.gradle's
// `defaultConfig { ndk { abiFilters ... } }` block directly. That DIDN'T
// work: the stock React Native Gradle template sets abiFilters again,
// later in the same file, driven by a gradle property called
// `reactNativeArchitectures` — and that later assignment overwrote ours.
//
// The fix is to set that exact property instead of fighting the template:
// this writes `reactNativeArchitectures=arm64-v8a` into
// android/gradle.properties, which is precisely the mechanism the
// template already reads. This is also the officially documented way
// React Native itself recommends for shrinking APK size.
// ────────────────────────────────────────────────────────────────────────────
const { withGradleProperties } = require('@expo/config-plugins');

const ARCHITECTURES = ['arm64-v8a'];
// If you ever need 32-bit device support too, use:
// const ARCHITECTURES = ['arm64-v8a', 'armeabi-v7a'];

function withAbiFilters(config) {
  return withGradleProperties(config, (config) => {
    // Drop any pre-existing entry first so we don't end up with duplicates
    // across repeated `expo prebuild` runs.
    config.modResults = config.modResults.filter(
      (item) => !(item.type === 'property' && item.key === 'reactNativeArchitectures')
    );
    config.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: ARCHITECTURES.join(','),
    });
    return config;
  });
}

module.exports = withAbiFilters;
