export default {
  env: {
    browser: true,
    es2021: true,
    node: true,
  },
  extends: "google",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    "max-len": ["warn", 120],
    camelcase: "off",
    "object-curly-spacing": "off",
    quotes: "off",
    indent: ["warn", 2],
    "comma-dangle": "off",
  },
};
