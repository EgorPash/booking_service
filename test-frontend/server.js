"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.FRONTEND_PORT || 4000);
const API_ORIGIN = process.env.API_ORIGIN || "http://127.0.0.1:3000";
const api = new URL(API_ORIGIN);
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(ROOT, rel);
  if (path.relative(ROOT, filePath).startsWith("..")) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Доступ запрещён");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Не найдено: " + pathname);
      return;
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
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
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log("Тестовый фронтенд: http://localhost:" + PORT);
  console.log("Запросы /api/* проксируются на " + API_ORIGIN);
  console.log("Сначала запустите backend: в папке server/ выполните npm start");
});
