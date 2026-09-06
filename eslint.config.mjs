import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Lint configuration.
 *
 * Type-aware rules are enabled deliberately. Most of the mistakes that matter
 * in this codebase are type-shaped — a floating promise in the signaling
 * relay, an unchecked `any` from a WebRTC stats object — and the rules that
 * catch those need type information to work at all.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-types/**',
      '**/build/**',
      '**/.turbo/**',
      '**/node_modules/**',
      '**/schema/**',
      'apps/android/**',
      'eslint.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Unused arguments are often deliberate — an ignored `event`, a
      // destructured field discarded on purpose. Requiring an underscore makes
      // the intent explicit rather than banning the pattern.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // A dropped promise in signaling or WebRTC negotiation fails silently and
      // looks like a network problem. Always mark intent with `void` or `await`.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false, attributes: false } },
      ],

      // WebRTC stats and Electron APIs return loosely typed objects; narrowing
      // them requires assertions that these rules would otherwise forbid.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',

      // `process.env['X']` bracket access is deliberate and reads consistently
      // with the rest of the config code; this rule only argues style.
      '@typescript-eslint/dot-notation': 'off',

      // Numbers in template literals are unambiguous and everywhere in the
      // logging and stats code.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // A DOM lookup helper exists precisely so the caller can name the
      // element type it expects; that is the pattern, not an accident.
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',

      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-globals': [
        'error',
        {
          name: 'Buffer',
          message:
            'Buffer does not exist in a browser or an Electron renderer. Use TextEncoder/TextDecoder in code shared with clients.',
        },
      ],
    },
  },

  // Build config files sit outside every build tsconfig, so the type-aware
  // rules have no program for them.
  {
    files: ['**/vite.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
  },

  // The Electron main process is built by its own tsconfig, and the default
  // tsconfig.json in that app covers the renderer. Point the type-aware rules
  // at the right program explicitly.
  {
    files: ['apps/desktop/src/main/**/*.ts', 'apps/desktop/src/main/**/*.cts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./apps/desktop/tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // A CommonJS preload has to be written as CommonJS. Electron only loads an
  // ESM preload when `sandbox: false`, and giving up the sandbox to gain an
  // import statement is a bad trade.
  {
    files: ['**/*.cts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },

  // Standalone Node scripts belong to no build program, so they get plain
  // linting plus Node's globals.
  {
    files: ['**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // Node-only code may use Buffer; it never runs in a browser.
  {
    files: ['services/**/*.ts', 'apps/desktop/src/main/**/*.ts', '**/*.mjs'],
    rules: { 'no-restricted-globals': 'off' },
  },

  // Tests are excluded from the build tsconfigs, so the type-aware rules have
  // no program to work from. They also reach into internals and stub globals
  // on purpose, which most of those rules would object to anyway.
  {
    files: ['**/*.test.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-restricted-globals': 'off',
      'no-undef': 'off',
    },
  },
);
