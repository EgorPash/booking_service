/* =========================================================
   web/js/cabinet.js — общие помощники экранов кабинета:
   статусы, даты, проверки активной записи и предупреждение
   о поздней отмене. Без запросов и без состояния страницы.
   ========================================================= */

"use strict";

(function () {
  var STATUS = {
    pending: { label: "Ожидает подтверждения", className: "is-pending" },
    confirmed: { label: "Подтверждена", className: "is-confirmed" },
    cancelled: { label: "Отменена", className: "is-cancelled" },
    completed: { label: "Завершена", className: "is-completed" },
    no_show: { label: "Не пришёл", className: "is-no-show" },
  };

  var LATE_LIMIT_MS = 2 * 60 * 60 * 1000;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function setText(node, text) {
    if (node) node.textContent = text === undefined || text === null ? "" : String(text);
  }

  function statusMeta(status) {
    return STATUS[status] || {
      label: status || "—",
      className: "is-neutral",
    };
  }

  function isActiveStatus(status) {
    return status === "pending" || status === "confirmed";
  }

  function startMs(booking) {
    var value = Date.parse(booking && booking.startsAt);
    return Number.isFinite(value) ? value : NaN;
  }

  function endMs(booking) {
    var value = Date.parse(booking && booking.endsAt);
    return Number.isFinite(value) ? value : NaN;
  }

  /* Запись показываем в «Активных», пока визит не закончился. */
  function isActiveVisit(booking) {
    if (!booking || !isActiveStatus(booking.status)) return false;
    var now = Date.now();
    var end = endMs(booking);
    if (Number.isFinite(end)) return end > now;
    var start = startMs(booking);
    return Number.isFinite(start) && start > now;
  }

  /* Действия доступны только до начала визита. */
  function isUpcoming(booking) {
    var start = startMs(booking);
    return isActiveStatus(booking && booking.status) &&
      Number.isFinite(start) && start > Date.now();
  }

  function needsLateWarning(booking) {
    var start = startMs(booking);
    if (!Number.isFinite(start)) return false;
    var left = start - Date.now();
    return left > 0 && left <= LATE_LIMIT_MS;
  }

  function dateParts(booking) {
    var local = booking && booking.startsAtLocal;
    var date = (local && local.date) || String((booking && booking.startsAt) || "").slice(0, 10);
    var parsed = window.BookingTime ? window.BookingTime.parseDate(date) : null;
    return {
      date: date,
      year: parsed ? parsed.y : null,
      month: parsed ? parsed.m : null,
      day: parsed ? parsed.d : null,
    };
  }

  function fullDate(booking) {
    var parts = dateParts(booking);
    if (!parts.date) return "—";
    var label = window.BookingTime
      ? window.BookingTime.humanDate(parts.date)
      : parts.date;
    if (parts.year && parts.year !== new Date().getFullYear()) {
      label += " " + parts.year;
    }
    return label;
  }

  function dayNumber(booking) {
    var parts = dateParts(booking);
    return parts.day ? String(parts.day) : "—";
  }

  function monthName(booking) {
    var parts = dateParts(booking);
    if (!parts.month || !window.BookingTime) return "";
    return window.BookingTime.MONTHS_GEN[parts.month - 1];
  }

  function timeRange(booking) {
    var local = booking && booking.startsAtLocal;
    var ends = booking && booking.endsAtLocal;
    var start = (local && local.time) || "—";
    var end = ends && ends.time;
    return end ? start + " – " + end : start;
  }

  function startTime(booking) {
    return (booking && booking.startsAtLocal && booking.startsAtLocal.time) || "—";
  }

  function price(booking) {
    if (!window.Format) return "—";
    return window.Format.price(booking && booking.priceMinor, booking && booking.currency);
  }

  function duration(booking) {
    if (!window.Format) return "—";
    return window.Format.duration(booking && booking.durationMin);
  }

  function redirectToAuth() {
    var file = window.location.pathname.split("/").pop() || "dashboard.html";
    var next = file + window.location.search;
    window.location.assign("auth.html?next=" + encodeURIComponent(next));
  }

  window.Cabinet = {
    LATE_LIMIT_MS: LATE_LIMIT_MS,
    el: el,
    setText: setText,
    statusMeta: statusMeta,
    isActiveStatus: isActiveStatus,
    isActiveVisit: isActiveVisit,
    isUpcoming: isUpcoming,
    needsLateWarning: needsLateWarning,
    dateParts: dateParts,
    fullDate: fullDate,
    dayNumber: dayNumber,
    monthName: monthName,
    timeRange: timeRange,
    startTime: startTime,
    price: price,
    duration: duration,
    redirectToAuth: redirectToAuth,
  };
})();
