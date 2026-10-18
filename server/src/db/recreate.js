"use strict";

/**
 * Пересоздание схемы базы «с нуля».
 *
 * Удаляет файл базы (и служебные WAL-файлы), затем заново создаёт её и
 * применяет все миграции по порядку. Тестовые данные НЕ заливаются —
 * для них есть отдельная команда `npm run seed` (или `npm run db:reset`).
 *
 * Запуск: npm run db:recreate
 */

const { closeDb } = require("./connection");
const { removeDatabaseFiles } = require("./reset");
const { runMigrations } = require("./migrate");
const { assertDestructiveAllowed } = require("./guards");

if (require.main === module) {
  try {
    assertDestructiveAllowed("db:recreate");
    removeDatabaseFiles();
    console.log("База удалена, создаю заново и применяю миграции...");
    runMigrations();
    console.log("База пересоздана (только схема, без тестовых данных).");
  } finally {
    closeDb();
  }
}

module.exports = {};
