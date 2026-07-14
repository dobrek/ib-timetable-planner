import { fixupConfigRules } from "@eslint/compat";
import { includeIgnoreFile } from "@eslint/config-helpers";
import { defineConfig } from "eslint/config";
import eslint from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import reactCompiler from "eslint-plugin-react-compiler";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
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

const ambientDeclConfig = defineConfig({
  files: ["**/*.d.ts"],
  rules: {
    // .d.ts files may use interface for namespace augmentation (e.g. App.Locals)
    "@typescript-eslint/consistent-type-definitions": "off",
  },
});

const reactConfig = defineConfig({
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
const nodeMjsConfig = defineConfig({
  files: ["**/*.mjs"],
  languageOptions: {
    globals: { process: "readonly", console: "readonly" },
  },
});

// `bench/` sits OUTSIDE the FSD graph — steiger lints `src/` only, so nothing else guards what the
// bench may import. It reaches into exactly one page slice: `plan-comparison`'s `api` segment, home of
// the shared `loadPlanAnalysis` (one loader, so the CLI and the in-app surface can never disagree
// about what a plan *is*). The slice ROOT is off-limits: it is a React island's home, and dragging
// React into `pnpm analyze:plans` — a Vitest *node* run — would break it. Everything else under
// `_pages` is off-limits outright.
const benchBoundaryConfig = defineConfig({
  files: ["bench/**/*.ts"],
  rules: {
    // The patterns are gitignore-style (ESLint matches `group` with the `ignore` package), and that
    // dialect has one sharp edge worth naming: a `!` cannot re-include a path whose PARENT DIRECTORY
    // an earlier pattern excluded. So `["@/_pages/*", "!@/_pages/plan-comparison/api"]` — the obvious
    // spelling — silently blocks the very import it means to permit, because `@/_pages/*` excludes the
    // `plan-comparison` directory itself. Hence the split below: the slice-root ban lives in `paths`
    // (exact-match, no subtree semantics), and each pattern group keeps the allowed path's parent
    // un-excluded. Verified against the real matcher, not assumed.
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@/_pages/plan-comparison",
            message:
              "bench/ must import @/_pages/plan-comparison/api, not the slice root — the root re-exports ui/, which would pull React into `pnpm analyze:plans` (a Vitest node run).",
          },
        ],
        patterns: [
          // Every other slice: root and all segments below it.
          {
            group: ["@/_pages/*", "!@/_pages/plan-comparison"],
            message:
              "bench/ may reach into exactly one page slice — @/_pages/plan-comparison/api, the shared plan loader. No other _pages slice is importable from bench/.",
          },
          // Inside plan-comparison: only the `api` segment barrel. Its `ui`/`model`/`lib` segments and
          // any deep import past the barrel (…/api/load-plan-analysis) stay forbidden.
          {
            group: ["@/_pages/plan-comparison/*", "@/_pages/plan-comparison/**", "!@/_pages/plan-comparison/api"],
            message:
              "bench/ may import only the @/_pages/plan-comparison/api barrel — never its ui/model/lib segments, and never a deep path past the barrel.",
          },
        ],
      },
    ],
  },
});

const astroConfig = defineConfig({
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

export default defineConfig(
  {
    ignores: ["src/shared/api/database.types.ts", "scripts/", "legacy-grouping-algorithm/", "steiger.config.ts"],
  },
  includeIgnoreFile(gitignorePath),
  baseConfig,
  ambientDeclConfig,
  reactConfig,
  nodeMjsConfig,
  benchBoundaryConfig,
  eslintPluginAstro.configs["flat/recommended"],
  ...eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  eslintPluginPrettier,
);
