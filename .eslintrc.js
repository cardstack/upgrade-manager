module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true,
  },
  extends: [
    "eslint:recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  parserOptions: {
    ecmaVersion: 12,
  },
  plugins: ["@typescript-eslint", "import", "prettier"],
  ignorePatterns: ["bin/**", "build/**", "coverage/**", "dist/**", "abi/**"],
  rules: {
    "prettier/prettier": "error",
    "prefer-const": "off",
    "import/order": [
      "error",
      {
        "newlines-between": "always",
        alphabetize: {
          order: "asc",
        },
      },
    ],
  },
};
