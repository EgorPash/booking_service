/* =========================================================
   web/js/format.js — общие форматтеры для экранов записи.
   Только вычисления и форматирование, без запросов и состояния.
   Деньги приходят в копейках, длительность — в минутах.
   ========================================================= */

"use strict";

(function () {
  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function duration(min) {
    if (!Number.isFinite(min) || min <= 0) return "—";
    var hours = Math.floor(min / 60);
    var minutes = min % 60;
    var parts = [];
    if (hours) parts.push(hours + " " + plural(hours, "час", "часа", "часов"));
    if (minutes) {
      parts.push(minutes + " " + plural(minutes, "минута", "минуты", "минут"));
    }
    return parts.join(" ");
  }

  function price(priceMinor, currency) {
    if (!Number.isFinite(priceMinor)) return "—";
    var value = priceMinor / 100;
    try {
      return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: currency || "RUB",
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      }).format(value);
    } catch (formatError) {
      return value + " " + (currency || "");
    }
  }

  function initial(fullName) {
    var text = String(fullName || "").trim();
    return text ? text.charAt(0).toUpperCase() : "?";
  }

  window.Format = {
    plural: plural,
    duration: duration,
    price: price,
    initial: initial,
  };
})();
