// ────────────────────────────────────────────────────────────────────────────
// Local Expo config plugin — restricts the Android build to arm64-v8a only.
//
// Why: without this, EAS builds a "universal" APK bundling native code for
// FOUR processor architectures (arm64-v8a, armeabi-v7a, x86, x86_64), even
// though 99% of real Android phones only need arm64-v8a. Every native
// module (Agora's voice engine especially, but also Hermes, Reanimated,
// expo-gl, etc.) gets duplicated 4x in the final APK. This is very likely
// the single biggest contributor to the app's install size.
//
// This plugin edits android/app/build.gradle (generated automatically by
// EAS during prebuild) to add an `ndk { abiFilters ... }` block, which
// tells Gradle to only package the one architecture we actually need.
//
// If you ever need to support older 32-bit devices too, add "armeabi-v7a"
// to the abiFilters array below — but that roughly doubles size again, so
// only do it if you actually have users on very old hardware.
// ────────────────────────────────────────────────────────────────────────────
const { withAppBuildGradle } = require('@expo/config-plugins');

const ABI_FILTERS = ['arm64-v8a'];

function withAbiFilters(config) {
  return withAppBuildGradle(config, (config) => {
    const marker = 'ndk {';
    if (config.modResults.contents.includes('abiFilters')) {
      // Already patched (e.g. re-running prebuild) — don't duplicate.
      return config;
    }

    const filtersLine = ABI_FILTERS.map((a) => `"${a}"`).join(', ');
    const ndkBlock = `\n        ndk {\n            abiFilters ${filtersLine}\n        }\n`;

    // Insert inside `defaultConfig { ... }` right after its opening brace.
    const defaultConfigRegex = /defaultConfig\s*{/;
    if (defaultConfigRegex.test(config.modResults.contents)) {
      config.modResults.contents = config.modResults.contents.replace(
        defaultConfigRegex,
        (match) => `${match}${ndkBlock}`
      );
    }

    return config;
  });
}

module.exports = withAbiFilters;
