"use strict";

/**
 * Простой прогонщик миграций.
 *
 * Все .sql-файлы из папки migrations применяются по порядку (сортировка по имени).
 * Уже применённые миграции пропускаются — учёт ведётся в таблице schema_migrations.
 * Каждая миграция применяется в транзакции: либо целиком, либо никак.
 *
 * На время прогона внешние ключи отключаются: некоторые миграции пересобирают
 * таблицы (DROP + RENAME), а с включёнными FK это затронуло бы связанные строки.
 * После прогона ключи включаются обратно, целостность проверяется foreign_key_check.
 */

const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("./connection");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function runMigrations() {
  const db = getDb();

  // PRAGMA foreign_keys нельзя менять внутри транзакции, поэтому отключаем
  // до начала прогона и включаем обратно после.
  db.exec("PRAGMA foreign_keys = OFF");

  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (" +
      "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "name TEXT NOT NULL UNIQUE, " +
      "applied_at TEXT NOT NULL" +
      ");"
  );

  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((row) => row.name)
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  try {
    for (const file of files) {
      if (applied.has(file)) {
        console.log("Пропуск (уже применена): " + file);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

      // В node:sqlite нет помощника transaction() — управляем транзакцией вручную
      db.exec("BEGIN");
      try {
        db.exec(sql);
        db.prepare(
          "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)"
        ).run(file, new Date().toISOString());
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      console.log("Применена: " + file);
    }

    const violations = db.prepare("PRAGMA foreign_key_check").all();
    if (violations.length > 0) {
      throw new Error(
        "Нарушения внешних ключей после миграций: " + JSON.stringify(violations)
      );
    }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }

  console.log("Миграции завершены.");
}

if (require.main === module) {
  try {
    runMigrations();
  } finally {
    closeDb();
  }
}

module.exports = { runMigrations };
