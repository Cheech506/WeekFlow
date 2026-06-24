module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': '<rootDir>/jest.transformer.js',
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^expo-sqlite$':
      '<rootDir>/__tests__/helpers/expoSqliteNodeAdapter.js',
    '^react-native$':
      '<rootDir>/__tests__/helpers/reactNativeMock.js',
    '^expo-document-picker$':
      '<rootDir>/__tests__/helpers/documentPickerMock.js',
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: [
    'lib/dateUtils.ts',
    'lib/progressStats.ts',
    'lib/weeklyReview.ts',
    'lib/recurrenceUtils.ts',
    'lib/backupValidation.ts',
    'lib/db.ts',
    'lib/taskStorage.ts',
    'lib/goalStorage.ts',
    'lib/brainDumpStorage.ts',
    'lib/recurringStorage.ts',
    'lib/backupStorage.ts',
  ],
};
