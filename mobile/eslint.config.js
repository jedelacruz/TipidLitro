// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // These two rules prepare code for the React Compiler, which this app does not enable
    // (experiments.reactCompiler in app.json). Screens load data in effects and show a
    // spinner first, and some labels use today's date; both are fine without the compiler.
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
    },
  },
]);
