module.exports = {
  projects: [
    {
      displayName: 'main',
      testMatch: [
        '<rootDir>/__tests__/main.test.js',
        '<rootDir>/__tests__/preload.test.js',
      ],
      testEnvironment: 'node',
      collectCoverageFrom: [
        '<rootDir>/ipc-handlers.js',
        '<rootDir>/operation-registry.js',
        '<rootDir>/window-security.js',
        '<rootDir>/preload.js',
      ],
      coverageThreshold: {
        global: { statements: 80, lines: 80, functions: 80, branches: 70 },
      },
    },
    {
      displayName: 'components',
      testMatch: ['<rootDir>/__tests__/components/**/*.test.js'],
      testEnvironment: 'jsdom',
      setupFiles: ['<rootDir>/__tests__/setup-jsdom.js'],
      transform: {
        '^.+\\.jsx?$': 'babel-jest',
      },
      transformIgnorePatterns: [
        '/node_modules/(?!(?:@ant-design/colors|@ant-design/fast-color)/)',
      ],
      moduleNameMapper: {
        '\\.css$': '<rootDir>/__tests__/__mocks__/styleMock.js',
      },
      collectCoverageFrom: [
        '<rootDir>/src/App.js',
        '<rootDir>/src/components/**/*.js',
      ],
      coverageThreshold: {
        global: { statements: 80, lines: 80, functions: 80, branches: 70 },
      },
    },
    {
      displayName: 'build',
      testMatch: ['<rootDir>/__tests__/build.test.js'],
      testEnvironment: 'node',
    },
  ],
};
