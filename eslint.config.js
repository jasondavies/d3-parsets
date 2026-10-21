import js from "@eslint/js";
import globals from "globals";

export default [
  {ignores: ["dist/**", "node_modules/**", "test/d3.v7.min.js", "test-results/**", "playwright-report/**"]},
  js.configs.recommended,
  {languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ["test/browser/*.js"], languageOptions: {globals: {
    chart: "readonly", svg: "readonly", mount: "readonly", parsets: "readonly", rows: "readonly",
    select: "readonly", selectAll: "readonly"
  }}}
];
