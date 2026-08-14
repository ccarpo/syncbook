import js from "@eslint/js";
import tseslint from "typescript-eslint";
export default [{ ignores: ["dist"] }, js.configs.recommended, ...tseslint.configs.recommended, {
  files: ["src/**/*.ts"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest", sourceType: "module" } },
  rules: { "no-undef": "off", "no-unused-vars": "off" }
}];
