"use strict";

const MAX_BODY_BYTES = 1_000_000;

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function badRequest(message, details) {
  return new HttpError(400, "invalid_request", message, details);
}

function unauthorized(message = "Требуется авторизация") {
  return new HttpError(401, "unauthorized", message);
}

function forbidden(message = "Недостаточно прав") {
  return new HttpError(403, "forbidden", message);
}

function notFound(message = "Не найдено") {
  return new HttpError(404, "not_found", message);
}

function conflict(message, details) {
  return new HttpError(409, "conflict", message, details);
}

function sendJson(res, status, body, headers) {
  const text = JSON.stringify(body === undefined ? null : body);
  const base = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  };
  res.writeHead(status, Object.assign(base, headers || {}));
  res.end(text);
}

/**
 * Отдаёт ошибку наружу.
 *
 * Наружу попадают сообщения ТОЛЬКО наших HttpError (они безопасны). Любая
 * неожиданная ошибка (в том числе текст ошибки СУБД и пути к файлам)
 * превращается в обезличенный 500 — подробности пишем только в лог сервера.
 */
function sendError(res, error) {
  const known = error instanceof HttpError && Number.isInteger(error.status);
  const status = known ? error.status : 500;
  const payload = {
    error: known ? error.code || "error" : "internal_error",
    message: known ? error.message : "Внутренняя ошибка сервера",
  };
  if (known && error.details !== undefined) payload.details = error.details;

  if (!known) {
    console.error("[request error]", (error && error.stack) || error);
  }

  const headers = {};
  if (known && Number.isFinite(error.retryAfter)) {
    headers["Retry-After"] = String(error.retryAfter);
  }
  sendJson(res, status, payload, headers);
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(badRequest("Тело запроса слишком большое"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return reject(badRequest("Тело запроса должно быть JSON-объектом"));
        }
        resolve(parsed);
      } catch (error) {
        reject(badRequest("Некорректный JSON в теле запроса"));
      }
    });

    req.on("error", reject);
  });
}

module.exports = {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  sendJson,
  sendError,
  parseCookies,
  readJsonBody,
};
