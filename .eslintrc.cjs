/*
  Unique Web Studio - ESLint Config
  Relaxed for existing codebase. Enables strict rules via comments when desired.
*/
module.exports = {
  env: { browser: true, es2021: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 'latest' },
  rules: {
    'no-unused-vars': 'warn',
    'no-undef': 'warn',
    'no-console': 'off',
    'no-constant-condition': 'warn',
    'no-empty': 'warn',
    'no-prototype-builtins': 'off',
  },
  globals: {
    Swiper: 'readonly',
    AOS: 'readonly',
    VanillaTilt: 'readonly',
    Chart: 'readonly',
    GitHubCloud: 'readonly',
    Notifier: 'readonly',
  },
  ignorePatterns: ['sw.js', 'manifest.json'],
};
