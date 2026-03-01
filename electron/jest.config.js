module.exports = {
  projects: [
    {
      displayName: 'main',
      testMatch: ['<rootDir>/__tests__/main.test.js'],
      testEnvironment: 'node',
    },
    {
      displayName: 'components',
      testMatch: ['<rootDir>/__tests__/components/**/*.test.js'],
      testEnvironment: 'jsdom',
      transform: {
        '^.+\\.jsx?$': 'babel-jest',
      },
      moduleNameMapper: {
        '\\.css$': '<rootDir>/__tests__/__mocks__/styleMock.js',
      },
    },
    {
      displayName: 'build',
      testMatch: ['<rootDir>/__tests__/build.test.js'],
      testEnvironment: 'node',
    },
  ],
};
