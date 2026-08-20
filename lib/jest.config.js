export default {
  transform: {},
  testMatch: ['**/__tests__/**/*.js', '**/*.test.js'],
  collectCoverageFrom: [
    '*.js',
    '!jest.config.js',
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      lines: 90,
      functions: 80,
      branches: 80,
    },
  },
};
