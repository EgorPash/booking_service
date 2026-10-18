"use strict";

/**
 * Конфигурация бэкенда.
 *
 * Читает переменные окружения из файла .env в корне проекта (если он есть)
 * и подставляет разумные значения по умолчанию. Никаких секретов в коде —
 * только значения из окружения.
 */

const fs = require("node:fs");
const path = require("node:path");

// server/src/config.js -> server/src -> server -> корень проекта
const ROOT_DIR = path.resolve(__dirname, "..", "..");

// Загружаем .env из корня проекта (встроенный механизм Node, без зависимостей)
const envFile = path.join(ROOT_DIR, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

/** Превращает относительный путь в абсолютный относительно корня проекта. */
function fromRoot(target) {
  return path.isAbsolute(target) ? target : path.join(ROOT_DIR, target);
}

const config = {
  rootDir: ROOT_DIR,
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  timezone: process.env.TZ || "Europe/Moscow",
  // Файл базы лежит в папке проекта и в git не попадает
  databasePath: fromRoot(process.env.DATABASE_PATH || "server/data/app.sqlite"),
  sessionSecret: process.env.SESSION_SECRET || "",
  passwordHashRounds: Number(process.env.PASSWORD_HASH_ROUNDS || 12),
};

// Ошибки конфигурации лучше ловить при старте, а не в момент запроса.
if (config.env === "production" && !config.sessionSecret) {
  throw new Error(
    "SESSION_SECRET обязателен при NODE_ENV=production " +
      "(задайте переменную окружения или добавьте в .env)."
  );
}

module.exports = config;
