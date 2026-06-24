module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': '<rootDir>/jest.transformer.js',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'lib/dateUtils.ts',
    'lib/progressStats.ts',
    'lib/weeklyReview.ts',
    'lib/recurrenceUtils.ts',
    'lib/backupValidation.ts',
  ],
};
