const { DatabaseSync } = require('node:sqlite');

/**
 * Jest-only adapter for Expo SQLite.
 *
 * The application asks for "weekflow.db", but this adapter deliberately ignores
 * that filename and always opens a new in-memory database. No file is created,
 * and the real Expo/Simulator database cannot be reached from these tests.
 */
function openDatabaseAsync(_requestedName) {
  const database = new DatabaseSync(':memory:');

  function normalizeParams(params) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return params[0];
    }

    return params;
  }

  const api = {
    __databaseLocation: ':memory:',

    async execAsync(sql) {
      database.exec(sql);
    },

    async runAsync(sql, ...params) {
      const statement = database.prepare(sql);
      const result = statement.run(...normalizeParams(params));

      return {
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: Number(result.changes),
      };
    },

    async getAllAsync(sql, ...params) {
      const statement = database.prepare(sql);
      return statement.all(...normalizeParams(params));
    },

    async getFirstAsync(sql, ...params) {
      const statement = database.prepare(sql);
      return statement.get(...normalizeParams(params)) ?? null;
    },

    async withTransactionAsync(callback) {
      database.exec('BEGIN');

      try {
        await callback();
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },

    async closeAsync() {
      database.close();
    },
  };

  return Promise.resolve(api);
}

module.exports = {
  openDatabaseAsync,
};
