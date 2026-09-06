const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const eslintConfigPrettier = require("eslint-config-prettier");

module.exports = tseslint.config(
  {
    ignores: ["node_modules/**", "logs/**", "screenshots/**", "dist/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      // Tool inputs/results are legitimately dynamic (LLM tool-call args, JSON.parse'd request
      // bodies, generic error values) -- banning `any` outright would force noisy casts for no
      // real safety gain in those specific spots.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
    },
  },
  {
    // This file itself: plain Node/CommonJS, not part of the tsconfig'd `src/` project.
    files: ["eslint.config.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { require: "readonly", module: "writable" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
