import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Defensive posture: an empty catch or a discarded error is the exact
      // failure mode that hid a crash in the prototype.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Interpolating a number is ordinary and readable. Everything else stays
      // banned, so an object or a nullable never lands in a message as
      // "[object Object]" or "undefined".
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // The drill engine must stay free of the DOM. That is what makes the
    // functional tests cheap and the regression suite possible.
    files: ['src/drill/engine.ts', 'src/ladder/**/*.ts', 'src/board/**/*.ts', 'src/keymap/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'Keep this module DOM-free.' },
        { name: 'document', message: 'Keep this module DOM-free.' },
        { name: 'localStorage', message: 'Go through the storage interface.' },
      ],
    },
  },
  {
    files: ['tests/e2e/**/*.ts'],
    ...playwright.configs['flat/recommended'],
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // A fixture is known-good, so asserting on it is clearer than guarding it.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `expect(() => f()).toThrow()` is the idiom; braces add nothing.
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Spreading an ASCII literal to iterate its characters is deliberate here.
      '@typescript-eslint/no-misused-spread': 'off',
    },
  },
  {
    // The ESLint config is JavaScript, so it is outside the TypeScript project
    // and cannot be type-aware linted.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
);
