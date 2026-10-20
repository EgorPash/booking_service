/* =========================================================
   web/js/api.js — единственная точка обращений к серверу.
   Правило: в страницах прямых запросов быть не должно,
   все данные берутся через window.API.
   Базовый путь относительный ("/api"), чтобы работать
   на том же источнике, что и backend (у API нет CORS).
   ========================================================= */

"use strict";

(function () {
  const BASE = "/api";

  function messageFor(status, payload) {
    if (payload && typeof payload.message === "string" && payload.message) {
      return payload.message;
    }
    switch (status) {
      case 400:
        return "Некорректный запрос.";
      case 401:
        return "Требуется вход.";
      case 403:
        return "Нет доступа.";
      case 404:
        return "Не найдено.";
      case 409:
        return "Время занято.";
      case 429:
        return "Слишком много попыток. Попробуйте позже.";
      case 502:
        return "API недоступно.";
      default:
        return status >= 500
          ? "Ошибка сервера. Попробуйте позже."
          : "Не удалось выполнить запрос.";
    }
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    const config = {
      method: opts.method || "GET",
      headers: headers,
      credentials: "same-origin",
    };
    if (opts.body !== undefined) {
      config.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json";
    }

    let response;
    try {
      response = await fetch(BASE + path, config);
    } catch (networkError) {
      const error = new Error("Нет связи с сервером. Проверьте подключение.");
      error.cause = networkError;
      throw error;
    }

    let payload = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (parseError) {
        payload = null;
      }
    }

    if (!response.ok) {
      const error = new Error(messageFor(response.status, payload));
      error.status = response.status;
      error.code = payload && payload.error;
      error.details = payload && payload.details;
      throw error;
    }

    return payload;
  }

  window.API = {
    request: request,
    getStudio: function () {
      return request("/studio");
    },
    getServices: function () {
      return request("/services");
    },
    getMasters: function (params) {
      const query =
        params && params.serviceId
          ? "?serviceId=" + encodeURIComponent(params.serviceId)
          : "";
      return request("/masters" + query);
    },

    /* Окна мастера на дату. Отдаёт свободные окна, а если сервер
       расширен — и всю сетку дня с отметкой available (занято/доступно). */
    getSlots: function (masterId, params) {
      const date = params && params.date ? params.date : "";
      const ids = (params && params.serviceIds) || [];
      const query =
        "?date=" + encodeURIComponent(date) +
        "&serviceIds=" + encodeURIComponent(ids.join(","));
      return request("/masters/" + encodeURIComponent(masterId) + "/slots" + query);
    },

    /* Удержание слота на время оформления:
       POST /api/holds → holdId/expiresAt/ttlSeconds,
       GET/DELETE /api/holds/:id — проверка и освобождение. */
    createHold: function (body) {
      return request("/holds", { method: "POST", body: body });
    },
    getHold: function (id) {
      return request("/holds/" + encodeURIComponent(id));
    },
    releaseHold: function (id) {
      return request("/holds/" + encodeURIComponent(id), { method: "DELETE" });
    },

    /* Запись: создание и чтение деталей (для экрана успеха). */
    createBooking: function (body) {
      return request("/bookings", { method: "POST", body: body });
    },
    getBooking: function (id) {
      return request("/bookings/" + encodeURIComponent(id));
    },
    rescheduleBooking: function (id, body) {
      return request("/bookings/" + encodeURIComponent(id), {
        method: "PATCH",
        body: body,
      });
    },
    cancelBooking: function (id) {
      return request("/bookings/" + encodeURIComponent(id) + "/cancel", {
        method: "POST",
      });
    },

    /* Авторизация. Токен сессии не читаем и не храним:
       сервер сам ставит cookie `sid` (HttpOnly) при входе. */
    getMe: function () {
      return request("/auth/me");
    },
    login: function (body) {
      return request("/auth/login", { method: "POST", body: body });
    },
    register: function (body) {
      return request("/auth/register", { method: "POST", body: body });
    },
    logout: function () {
      return request("/auth/logout", { method: "POST" });
    },
    getMyBookings: function () {
      return request("/bookings/my");
    },
  };
})();
