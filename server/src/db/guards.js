"use strict";

/**
 * Защита от случайного запуска dev-инструментов на проде.
 *
 * `db:reset` полностью удаляет файл базы, а `seed` заливает тестовые данные.
 * На production такое должно быть невозможно без явного согласия.
 */

const config = require("../config");

function assertDestructiveAllowed(operation) {
  if (config.env === "production" && process.env.ALLOW_DESTRUCTIVE !== "1") {
    throw new Error(
      'Операция "' +
        operation +
        '" удаляет данные и запрещена при NODE_ENV=production. ' +
        "Если это осознанное решение, запустите с ALLOW_DESTRUCTIVE=1."
    );
  }
}

module.exports = { assertDestructiveAllowed };
