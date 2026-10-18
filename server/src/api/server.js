"use strict";

const http = require("node:http");
const config = require("../config");
const { Router } = require("./router");
const { sendJson, sendError, readJsonBody } = require("./http");
const { authenticate, purgeExpiredSessions } = require("./session");
const { cleanupExpiredHolds } = require("./holds");

const router = new Router();
require("./routes/auth").register(router);
require("./routes/catalog").register(router);
require("./routes/availability").register(router);
require("./routes/holds").register(router);
require("./routes/bookings").register(router);
require("./routes/admin").register(router);

const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const pathname = url.pathname.replace(/\/+$/, "") || "/";

    const match = router.match(req.method, pathname);
    if (!match) {
      return sendJson(res, 404, { error: "not_found", message: "Эндпоинт не найден" });
    }

    const ctx = {
      req,
      res,
      params: match.params,
      query: url.searchParams,
      method: req.method,
      path: pathname,
      status: 200,
      user: null,
      body: {},
    };

    if (BODY_METHODS.has(req.method)) ctx.body = await readJsonBody(req);
    ctx.user = authenticate(req);

    const result = await match.handler(ctx);
    if (res.headersSent) return;
    if (ctx.status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    sendJson(res, ctx.status || 200, result);
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    sendError(res, error);
  }
});

function cleanupExpired() {
  try {
    cleanupExpiredHolds();
  } catch (error) {
    console.error("Не удалось очистить истёкшие удержания:", error.message);
  }
  try {
    purgeExpiredSessions();
  } catch (error) {
    console.error("Не удалось очистить истёкшие сессии:", error.message);
  }
}

cleanupExpired();

const timer = setInterval(cleanupExpired, 60 * 1000);
timer.unref();

server.listen(config.port, () => {
  console.log("API запущено: http://localhost:" + config.port + " (NODE_ENV=" + config.env + ")");
});

module.exports = { server, router };
