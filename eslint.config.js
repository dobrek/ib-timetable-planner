/* eslint-disable @typescript-eslint/no-deprecated -- tseslint.config() is the only way to use extends; core defineConfig has incompatible API */
import { fixupConfigRules } from "@eslint/compat";
import { includeIgnoreFile } from "@eslint/config-helpers";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = tseslint.config({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
    "@typescript-eslint/consistent-type-definitions": ["error", "type"],
  },
});

const ambientDeclConfig = tseslint.config({
  files: ["**/*.d.ts"],
  rules: {
    // .d.ts files may use interface for namespace augmentation (e.g. App.Locals)
    "@typescript-eslint/consistent-type-definitions": "off",
  },
});

const reactConfig = tseslint.config({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: fixupConfigRules([pluginReact.configs.flat.recommended]),
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  plugins: {
    "react-hooks": eslintPluginReactHooks,
    "react-compiler": reactCompiler,
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...eslintPluginReactHooks.configs.recommended.rules,
    "react/react-in-jsx-scope": "off",
    "react-compiler/react-compiler": "error",
  },
});

// Node-runtime ESM modules (root config files, e2e Node helpers like the shared
// author-credentials module) read `process.env` and other Node globals. They live
// outside src/ and aren't browser code, so give them the Node global scope rather
// than the React/browser defaults — otherwise `no-undef` flags `process`.
const nodeModulesConfig = tseslint.config({
  files: ["**/*.mjs"],
  languageOptions: {
    globals: { process: "readonly", console: "readonly" },
  },
});

const astroConfig = tseslint.config({
  files: ["**/*.astro"],
  languageOptions: {
    parserOptions: {
      parser: tseslint.parser,
      project: true,
      projectService: false,
    },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

export default tseslint.config(
  {
    ignores: ["src/shared/api/database.types.ts", "scripts/", "legacy-grouping-algorithm/", "steiger.config.ts"],
  },
  includeIgnoreFile(gitignorePath),
  baseConfig,
  ambientDeclConfig,
  reactConfig,
  nodeModulesConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  eslintPluginPrettier,
);
