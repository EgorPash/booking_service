"use strict";

/**
 * Полное пересоздание базы с нуля.
 *
 * Удаляет файл базы (и служебные WAL-файлы), затем применяет миграции
 * и заливает тестовые данные. Удобно, когда нужно получить чистую
 * предсказуемую базу одной командой.
 *
 * Запуск: npm run db:reset
 */

const fs = require("node:fs");
const config = require("../config");
const { closeDb } = require("./connection");
const { runMigrations } = require("./migrate");
const { seed } = require("./seed");
const { assertDestructiveAllowed } = require("./guards");

/** Удаляет файл базы и служебные файлы WAL/SHM, если они есть. */
function removeDatabaseFiles() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = config.databasePath + suffix;
    fs.rmSync(file, { force: true });
  }
}

if (require.main === module) {
  (async () => {
    try {
      assertDestructiveAllowed("db:reset");
      removeDatabaseFiles();
      console.log("База удалена, пересоздаю с нуля...");
      await runMigrations();
      await seed();
      console.log("База пересоздана.");
    } catch (error) {
      console.error("Ошибка db:reset: " + error.message);
      process.exitCode = 1;
    } finally {
      closeDb();
    }
  })();
}

module.exports = { removeDatabaseFiles };
