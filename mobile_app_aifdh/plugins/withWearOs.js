const { withSettingsGradle } = require("@expo/config-plugins");

// Wires the standalone Wear OS app module (../wear) into the generated
// Android Gradle build so `./gradlew :wear:assembleDebug` works after prebuild.
// The wear module source lives outside android/ so it survives prebuild regen.
const withWearOs = (config) => {
  return withSettingsGradle(config, (cfg) => {
    const marker = "include ':wear'";
    if (!cfg.modResults.contents.includes(marker)) {
      cfg.modResults.contents +=
        `\n${marker}\n` +
        `project(':wear').projectDir = new File(rootProject.projectDir, '../wear')\n`;
    }
    return cfg;
  });
};

module.exports = withWearOs;
