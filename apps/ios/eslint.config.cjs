const babelParser = require('@babel/eslint-parser');

module.exports = [
  { ignores: ['ios/**', 'android/**', 'dist/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { presets: ['babel-preset-expo'] } },
    },
    rules: { 'no-debugger': 'error', 'no-duplicate-imports': 'error' },
  },
];
