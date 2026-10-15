import { includeIgnoreFile } from "@eslint/compat";
import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { fileURLToPath } from "node:url";

const reactFiles = ["**/*.{js,jsx,ts,tsx}"];
const tsFiles = ["**/*.{ts,tsx}"];

export default [
  includeIgnoreFile(fileURLToPath(new URL("./.gitignore", import.meta.url))),
  { ignores: ["public/build/**"] },

  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.commonjs, shopify: "readonly" },
    },
  },

  // React
  {
    ...react.configs.flat.recommended,
    files: reactFiles,
  },
  {
    ...react.configs.flat["jsx-runtime"],
    files: reactFiles,
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: reactFiles,
  },
  {
    files: reactFiles,
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/no-unknown-property": ["error", { ignore: ["variant"] }],
    },
    settings: {
      react: { version: "detect" },
      formComponents: ["Form"],
      linkComponents: [
        { name: "Link", linkAttribute: "to" },
        { name: "NavLink", linkAttribute: "to" },
      ],
    },
  },

  // TypeScript
  ...tsPlugin.configs["flat/recommended"].map((config) => ({
    ...config,
    files: tsFiles,
  })),
  {
    ...importPlugin.flatConfigs.recommended,
    files: tsFiles,
  },
  {
    ...importPlugin.flatConfigs.typescript,
    files: tsFiles,
  },
  {
    files: tsFiles,
    languageOptions: { parser: tsParser },
    settings: {
      "import/internal-regex": "^~/",
      "import/resolver": {
        node: { extensions: [".ts", ".tsx"] },
        typescript: { alwaysTryTypes: true },
      },
    },
  },

  // Node
  {
    files: ["eslint.config.js", "vite.config.{js,ts}", "**/*.server.{js,ts}", "scripts/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
];
