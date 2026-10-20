/* =========================================================
   web/js/booking-time.js — чистые помощники для экрана записи:
   календарь месяца, группировка окон по времени суток и
   форматирование времени. Никаких запросов и состояния —
   только вычисления для отрисовки.
   ========================================================= */

"use strict";

(function () {
  var MONTHS = [
    "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
  ];
  var MONTHS_GEN = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];
  var WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  var WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

  var PARTS = ["morning", "day", "evening"];
  var PART_LABELS = { morning: "Утро", day: "День", evening: "Вечер" };

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function parseDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ""));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function toDateStr(y, m, d) {
    return y + "-" + pad2(m) + "-" + pad2(d);
  }

  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /* День недели по ISO: Пн=1 … Вс=7. */
  function isoWeekday(y, m, d) {
    var wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return wd === 0 ? 7 : wd;
  }

  /* Сдвиг даты на n дней (в формате YYYY-MM-DD). */
  function addDays(dateStr, n) {
    var p = parseDate(dateStr);
    if (!p) return "";
    var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
    return toDateStr(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }

  /* Сетка месяца: массив недель по 7 ячеек, неделя с понедельника.
     Ячейка: { date, day, inMonth, weekday }. */
  function monthMatrix(year, month) {
    var total = daysInMonth(year, month);
    var first = isoWeekday(year, month, 1);
    var prevY = month === 1 ? year - 1 : year;
    var prevM = month === 1 ? 12 : month - 1;
    var prevTotal = daysInMonth(prevY, prevM);
    var nextY = month === 12 ? year + 1 : year;
    var nextM = month === 12 ? 1 : month + 1;

    var cells = [];
    var i;
    for (i = first - 1; i > 0; i -= 1) {
      var pd = prevTotal - i + 1;
      cells.push({ date: toDateStr(prevY, prevM, pd), day: pd, inMonth: false, weekday: isoWeekday(prevY, prevM, pd) });
    }
    for (i = 1; i <= total; i += 1) {
      cells.push({ date: toDateStr(year, month, i), day: i, inMonth: true, weekday: isoWeekday(year, month, i) });
    }
    var nd = 1;
    while (cells.length % 7 !== 0) {
      cells.push({ date: toDateStr(nextY, nextM, nd), day: nd, inMonth: false, weekday: isoWeekday(nextY, nextM, nd) });
      nd += 1;
    }

    var weeks = [];
    for (i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  function addMonths(year, month, delta) {
    var total = year * 12 + (month - 1) + delta;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
  }

  function monthLabel(year, month) {
    return MONTHS[month - 1] + " " + year;
  }

  function humanDate(dateStr) {
    var p = parseDate(dateStr);
    if (!p) return dateStr || "";
    return p.d + " " + MONTHS_GEN[p.m - 1] + ", " + WEEKDAYS_SHORT[isoWeekday(p.y, p.m, p.d) - 1];
  }

  /* Часть дня по локальному времени "HH:MM". */
  function partOfDay(time) {
    var m = /^(\d{1,2}):/.exec(String(time || ""));
    var hour = m ? Number(m[1]) : 0;
    if (hour < 12) return { key: "morning", label: PART_LABELS.morning };
    if (hour < 17) return { key: "day", label: PART_LABELS.day };
    return { key: "evening", label: PART_LABELS.evening };
  }

  /* Группировка окон по частям дня: [{key,label,slots}]. */
  function groupByPart(slots) {
    var buckets = { morning: [], day: [], evening: [] };
    (slots || []).forEach(function (slot) {
      buckets[partOfDay(slot.time).key].push(slot);
    });
    return PARTS.map(function (key) {
      return { key: key, label: PART_LABELS[key], slots: buckets[key] };
    }).filter(function (group) {
      return group.slots.length > 0;
    });
  }

  /* Локальное время HH:MM из UTC-ISO в заданной зоне. */
  function timeInZone(iso, timeZone) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timeZone,
      }).format(new Date(iso));
    } catch (error) {
      var m = /T(\d{2}):(\d{2})/.exec(String(iso));
      return m ? m[1] + ":" + m[2] : "";
    }
  }

  /* Сегодняшняя дата (YYYY-MM-DD) в заданной зоне. */
  function todayInZone(timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone: timeZone,
      }).format(new Date());
    } catch (error) {
      var now = new Date();
      return toDateStr(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
    }
  }

  window.BookingTime = {
    MONTHS: MONTHS,
    MONTHS_GEN: MONTHS_GEN,
    WEEKDAYS: WEEKDAYS,
    pad2: pad2,
    parseDate: parseDate,
    toDateStr: toDateStr,
    daysInMonth: daysInMonth,
    isoWeekday: isoWeekday,
    addDays: addDays,
    addMonths: addMonths,
    monthMatrix: monthMatrix,
    monthLabel: monthLabel,
    humanDate: humanDate,
    partOfDay: partOfDay,
    groupByPart: groupByPart,
    timeInZone: timeInZone,
    todayInZone: todayInZone,
  };
})();
