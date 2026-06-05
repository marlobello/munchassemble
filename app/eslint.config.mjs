import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // TypeScript itself checks for undefined identifiers; no-undef misfires on
      // ambient globals (console, process, NodeJS types) — disable per ts-eslint guidance.
      'no-undef': 'off',
      // Allow intentional `_`-prefixed unused args/vars (e.g. _s, _jobs).
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Explicit `any` is used deliberately in a few serialization/test spots.
      '@typescript-eslint/no-explicit-any': 'warn',
      // console logging is the app's intended observability sink.
      'no-console': 'off',
    },
  },
  {
    // Tests use Jest globals and some loose typing.
    files: ['tests/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
  },
];
