"use strict";

/**
 * Локальный сервер клиентской части (web/).
 *
 * Отдаёт статику из этой папки и проксирует /api/* на backend (server/).
 * Сборщика нет: правила проекта требуют, чтобы фронтенд открывался как есть.
 *
 *   node web/server.js                 → http://localhost:4100
 *   WEB_PORT=5000 API_ORIGIN=... node web/server.js
 *
 * Сначала запустите backend: в папке server/ выполните npm start.
 *
 * Раздел /admin закрыт на сервере: перед отдачей страницы спрашиваем у
 * backend GET /api/admin/access (роль admin из БД). Нет роли — отдаём 403
 * со страницей admin-denied.html. Это основная защита; скрытие ссылки
 * в шапке клиента — только удобство.
 */

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.WEB_PORT || 4100);
const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:3000";
const api = new URL(API_ORIGIN);
const ROOT = __dirname;

/* Админ-раздел: префикс пути и страница отказа. */
const ADMIN_PREFIX = "/admin";
const DENIED_PAGE = "admin-denied.html";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

function isAdminPath(pathname) {
  return pathname === ADMIN_PREFIX || pathname.startsWith(ADMIN_PREFIX + "/");
}

function serveStatic(res, pathname) {
  let rel;
  try {
    rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch (error) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Некорректный адрес");
    return;
  }
  const filePath = path.join(ROOT, rel);
  if (path.relative(ROOT, filePath).startsWith("..")) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Доступ запрещён");
    return;
  }
  // Каталог отдаём его index.html: /admin/ → admin/index.html
  fs.stat(filePath, (statError, stats) => {
    const target =
      !statError && stats.isDirectory() ? path.join(filePath, "index.html") : filePath;
    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Не найдено: " + pathname);
        return;
      }
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  });
}

/* Страница отказа: показываем и текст, и верный код ответа. */
function serveDenied(res) {
  const filePath = path.join(ROOT, DENIED_PAGE);
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Этот раздел только для администраторов");
      return;
    }
    res.writeHead(403, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

/**
 * Спрашивает у backend, есть ли у сессии роль admin.
 * Ответ: { allowed: true } или { allowed: false }.
 * Если backend недоступен — доступа не даём (закрыто по умолчанию).
 */
function checkAdminAccess(req, callback) {
  const upstream = http.request(
    {
      hostname: api.hostname,
      port: api.port || 80,
      path: "/api/admin/access",
      method: "GET",
      headers: {
        accept: "application/json",
        cookie: req.headers.cookie || "",
      },
    },
    (up) => {
      up.resume();
      callback(up.statusCode === 200);
    }
  );

  upstream.on("error", (error) => {
    console.error("[admin] не удалось проверить доступ:", error.message);
    callback(false);
  });

  upstream.end();
}

/* Отдача админ-раздела: сначала права, потом файл. */
function serveAdmin(req, res, pathname) {
  // /admin → /admin/, иначе относительные ссылки внутри раздела ломаются.
  if (pathname === ADMIN_PREFIX) {
    res.writeHead(301, { Location: ADMIN_PREFIX + "/" });
    res.end();
    return;
  }
  checkAdminAccess(req, function (allowed) {
    if (!allowed) {
      serveDenied(res);
      return;
    }
    serveStatic(res, pathname);
  });
}


function proxy(req, res) {
  const upstream = http.request(
    {
      hostname: api.hostname,
      port: api.port || 80,
      path: req.url,
      method: req.method,
      headers: Object.assign({}, req.headers, { host: api.host }),
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    }
  );

  upstream.on("error", (error) => {
    const body = JSON.stringify({
      error: "bad_gateway",
      message: "API недоступно (" + API_ORIGIN + "): " + error.message,
    });
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    }
    res.end(body);
  });

  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    proxy(req, res);
    return;
  }
  if (isAdminPath(url.pathname)) {
    serveAdmin(req, res, url.pathname);
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log("Клиентская часть: http://localhost:" + PORT);
  console.log("Запросы /api/* проксируются на " + API_ORIGIN);
  console.log("Сначала запустите backend: в папке server/ выполните npm start");
});
