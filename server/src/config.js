"use strict";

/**
 * Конфигурация бэкенда.
 *
 * Читает переменные окружения из файла .env в корне проекта (если он есть).
 *
 * В коде НЕ хранится никаких секретов и паролей. Здесь только то, что
 * действительно относится к окружению/развёртыванию: путь к базе, порт,
 * срок жизни сессии и лимиты частоты запросов.
 *
 * Настройки продукта, которые может менять администратор салона (часовой
 * пояс, шаг сетки слотов, время жизни удержания и т. п.), хранятся в БД —
 * в таблице `studios`, а не в .env.
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

/**
 * Читает целое число из окружения с проверкой и «зажимом» в диапазон.
 * Некорректное значение (NaN) не должно ломать безопасность (например,
 * обращать TTL сессии или rate-limit в ноль), поэтому берём значение по
 * умолчанию.
 */
function intEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

const config = {
  rootDir: ROOT_DIR,
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 3000),
  // Резервный часовой пояс, если в таблице studios ещё нет настройки.
  // Основной источник — studios.timezone (меняется администратором в БД).
  timezone: process.env.TZ || "Europe/Moscow",
  // Файл базы лежит в папке проекта и в git не попадает
  databasePath: fromRoot(process.env.DATABASE_PATH || "server/data/app.sqlite"),

  // --- Безопасность (только окружение, значения по умолчанию безопасны) ---
  // Срок жизни сессии (токена) в часах (1 час .. 365 суток).
  sessionTtlHours: intEnv("SESSION_TTL_HOURS", 168, { min: 1, max: 24 * 365 }),
  // Ограничение частоты запросов для входа и регистрации:
  // не более rateLimitMax попыток за rateLimitWindowSeconds секунд с одного IP.
  rateLimitMax: intEnv("RATE_LIMIT_MAX", 10, { min: 1, max: 100000 }),
  rateLimitWindowSeconds: intEnv("RATE_LIMIT_WINDOW_SECONDS", 300, { min: 1, max: 24 * 60 * 60 }),
  // Доверять ли заголовку X-Forwarded-For. По умолчанию НЕТ: иначе клиент
  // подделает заголовок и обойдёт rate-limit. Включать (TRUST_PROXY=1) только
  // когда приложение стоит за своим обратным прокси, который перезаписывает XFF.
  trustProxy: process.env.TRUST_PROXY === "1",
};

module.exports = config;
