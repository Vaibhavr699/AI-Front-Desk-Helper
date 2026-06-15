const { withAndroidManifest } = require("@expo/config-plugins");

// Declaring ACCESS_FINE_LOCATION makes Google Play implicitly require GPS
// hardware (android.hardware.location.gps), excluding devices without it.
// GPS here only powers the optional "suggest visit state" convenience — reps
// can always pick the state manually — so we mark the feature not required so
// those devices stay supported.
const FEATURES = [
  "android.hardware.location.gps",
  "android.hardware.location",
];

const withOptionalGps = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-feature"] = manifest["uses-feature"] || [];

    for (const name of FEATURES) {
      const existing = manifest["uses-feature"].find(
        (f) => f.$ && f.$["android:name"] === name,
      );
      if (existing) {
        existing.$["android:required"] = "false";
      } else {
        manifest["uses-feature"].push({
          $: { "android:name": name, "android:required": "false" },
        });
      }
    }

    return cfg;
  });
};

module.exports = withOptionalGps;
