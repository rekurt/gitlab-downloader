const nodeGlobals = {
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  Buffer: 'readonly',
  DOMException: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  clearInterval: 'readonly',
  clearTimeout: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  process: 'readonly',
  setImmediate: 'readonly',
  setInterval: 'readonly',
  setTimeout: 'readonly',
};

const rules = {
  eqeqeq: ['error', 'always'],
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-undef': 'error',
  'no-unreachable': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': 'error',
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/coverage/**',
      'electron/dist/**',
      'electron/dist_electron/**',
    ],
  },
  {
    files: ['*.js', 'lib/**/*.js', 'cli/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules,
  },
  {
    files: [
      'electron/*.js',
      'electron/__tests__/*.js',
      'electron/__tests__/__mocks__/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...nodeGlobals,
        __dirname: 'readonly',
        jest: 'readonly',
        require: 'readonly',
        module: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        test: 'readonly',
      },
    },
    rules,
  },
  {
    files: [
      'electron/src/**/*.js',
      'electron/__tests__/components/**/*.js',
      'electron/__tests__/setup-jsdom.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...nodeGlobals,
        document: 'readonly',
        navigator: 'readonly',
        window: 'readonly',
        jest: 'readonly',
        describe: 'readonly',
        expect: 'readonly',
        test: 'readonly',
      },
    },
    rules,
  },
];
