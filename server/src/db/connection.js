"use strict";

/**
 * Подключение к SQLite.
 *
 * Использует встроенный в Node.js модуль `node:sqlite` (без нативных
 * зависимостей). Открывает файл базы из конфигурации, включает внешние ключи
 * и WAL-режим. Соединение одно на процесс и переиспользуется (ленивая
 * инициализация).
 */

const fs = require("node:fs");
const path = require("node:path");
const sqlite = require("node:sqlite");
const config = require("../config");

// В старых версиях Node класс называется DatabaseSync, в новых — Database.
// Поддерживаем оба варианта, чтобы код работал и на 22.x, и на 24+.
const SqliteDatabase = sqlite.Database || sqlite.DatabaseSync;

let db = null;

/** Возвращает открытое соединение с базой (создаёт при первом вызове). */
function getDb() {
  if (db) return db;

  // Создаём папку под файл базы, если её ещё нет
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

  db = new SqliteDatabase(config.databasePath);

  // Внешние ключи: в node:sqlite включены по умолчанию, но задаём явно,
  // чтобы поведение не зависело от версии Node.js
  db.exec("PRAGMA foreign_keys = ON");
  // WAL ускоряет чтение и запись, меньше блокировок
  db.exec("PRAGMA journal_mode = WAL");
  // Ждать снятия блокировки до 5 секунд вместо мгновенной ошибки
  db.exec("PRAGMA busy_timeout = 5000");

  return db;
}

/** Закрывает соединение (используется в CLI-скриптах миграций и сидов). */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };
