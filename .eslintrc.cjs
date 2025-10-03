/* eslint-env node */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
    sourceType: 'module',
    ecmaVersion: 'latest',
  },
  plugins: [
    '@typescript-eslint',
    'import',
    'promise',
    'unicorn',
    'n',
    'security',
    'eslint-comments',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:@typescript-eslint/recommended-requiring-type-checking',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:promise/recommended',
    'plugin:unicorn/recommended',
    'plugin:n/recommended',
    'plugin:eslint-comments/recommended',
    'prettier',
  ],
  settings: {
    'import/resolver': {
      // Let ESLint understand TS paths and .ts extensions
      typescript: true,
      node: true,
    },
    // Inform eslint-plugin-n of the supported Node.js version
    node: {
      version: '>=18.0.0',
    },
  },
  globals: {
    // Node 18+ has global fetch and related Web APIs; mark as readonly to avoid no-undef
    fetch: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    Headers: 'readonly',
    FormData: 'readonly',
    ReadableStream: 'readonly',
    WritableStream: 'readonly',
    TransformStream: 'readonly',
    Blob: 'readonly',
    File: 'readonly',
  },
  rules: {
    /* ---------- TypeScript ---------- */
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
    '@typescript-eslint/explicit-module-boundary-types': 'error',
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false, ignoreIIFE: false }],
    '@typescript-eslint/no-misused-promises': [
      'error',
      { checksVoidReturn: { arguments: false, attributes: false } },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/no-throw-literal': 'error',
    '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],

    // We rely heavily on zod-validation; keep the "no-unsafe-*" family relaxed for now.
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-member-access': 'off',

    /* ---------- Imports ---------- */
    'import/no-default-export': 'error',
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: [
          '**/tests/**',
          '**/*.test.ts',
          'tools/**',
          'vitest.config.ts',
          'build.config.js',
        ],
      },
    ],
    'import/order': [
      'error',
      {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index'], 'type'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],

    /* ---------- Node ---------- */
    'n/no-missing-import': 'off', // TS resolver handles this
    'n/no-unsupported-features/es-syntax': 'off',
    'n/no-unsupported-features/node-builtins': ['error', { version: '>=18.0.0' }],

    /* ---------- Promises ---------- */
    'promise/no-multiple-resolved': 'error',
    'promise/no-return-wrap': 'error',
    'promise/no-nesting': 'warn',

    /* ---------- Unicorn (selectively tuned) ---------- */
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/no-null': 'off',
    'unicorn/no-process-exit': 'off', // CLI
    'unicorn/filename-case': ['warn', { case: 'kebabCase' }],
    'unicorn/no-array-reduce': 'off',

    /* ---------- Security ---------- */
    'security/detect-object-injection': 'off', // noisy; revisit if needed

    /* ---------- General ---------- */
    'eslint-comments/no-unused-disable': 'error',
    'no-console': 'off',
    'no-restricted-syntax': [
      'error',
      {
        selector: 'TSEnumDeclaration',
        message: 'Use union types or const objects instead of enums.',
      },
    ],
  },
  overrides: [
    {
      files: ['src/commands/**/*.ts'],
      rules: {
        '@typescript-eslint/explicit-module-boundary-types': 'off', // commands often export Commander instances
      },
    },
    {
      files: ['tests/**/*.ts'],
      rules: {
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        'import/no-default-export': 'off',
        'no-undef': 'off',
      },
    },
    {
      files: ['tools/**/*.ts', 'fixtures/**/*'],
      rules: {
        'import/no-extraneous-dependencies': 'off',
        // Tools are script-like; relax some strictness
        'n/hashbang': 'off',
        'n/no-process-exit': 'off',
        'unicorn/prefer-node-protocol': 'off',
        'unicorn/import-style': 'off',
        'unicorn/prefer-module': 'off',
        'unicorn/no-array-for-each': 'off',
        'unicorn/prefer-ternary': 'off',
        'unicorn/prefer-top-level-await': 'off',
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        'import/order': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'fixtures/', '*.d.ts'],
};
