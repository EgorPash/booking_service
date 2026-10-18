"use strict";

/**
 * Ограничение частоты запросов (rate limiting) без внешних зависимостей.
 *
 * Простой счётчик по скользящему окну в памяти процесса. Ключ — IP клиента
 * и имя «корзины» (bucket), чтобы лимиты на вход и регистрацию считались
 * независимо. Для одного инстанса этого достаточно; при горизонтальном
 * масштабировании лимитер нужно вынести в общий стор (Redis и т. п.).
 */

const config = require("../config");
const { HttpError } = require("./http");

const buckets = new Map();

function clientIp(req) {
  // X-Forwarded-For подделывается клиентом, поэтому доверяем ему ТОЛЬКО при
  // явно включённом TRUST_PROXY (приложение за своим обратным прокси).
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function pruneList(list, now, windowMs) {
  return list.filter((stamp) => now - stamp < windowMs);
}

function cleanup(now, windowMs) {
  for (const [key, list] of buckets) {
    const alive = pruneList(list, now, windowMs);
    if (alive.length === 0) buckets.delete(key);
    else buckets.set(key, alive);
  }
}

/**
 * Регистрирует попытку и бросает 429, если лимит исчерпан.
 * Способ создания ошибки не раскрывает внутренних деталей.
 */
function rateLimit(ctx, bucket) {
  const windowMs = Math.max(1, config.rateLimitWindowSeconds) * 1000;
  const max = Math.max(1, config.rateLimitMax);
  const now = Date.now();
  const key = bucket + "|" + clientIp(ctx.req);

  const list = pruneList(buckets.get(key) || [], now, windowMs);

  if (list.length >= max) {
    buckets.set(key, list);
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000));
    const error = new HttpError(
      429,
      "rate_limited",
      "Слишком много попыток. Повторите позже."
    );
    error.retryAfter = retryAfter;
    throw error;
  }

  list.push(now);
  buckets.set(key, list);

  if (buckets.size > 5000) cleanup(now, windowMs);
}

/** Очистка состояния (для тестов). */
function reset() {
  buckets.clear();
}

module.exports = { rateLimit, reset };
