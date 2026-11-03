const babelParser = require('@babel/eslint-parser');

module.exports = [
  { ignores: ['ios/**', 'android/**', 'dist/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: { requireConfigFile: false, babelOptions: { presets: ['babel-preset-expo'] } },
    },
    rules: {
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text', 'TextInput'],
              message: "Import Text and TextInput from src/ui/Text: they set the app's regular weight.",
            },
          ],
        },
      ],
    },
  },
  { files: ['src/ui/Text.tsx'], rules: { 'no-restricted-imports': 'off' } },
];
