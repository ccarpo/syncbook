import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [
  { ignores: ["dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    rules: { "no-unused-vars": "off" },
  },
];
