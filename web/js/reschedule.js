/* =========================================================
   web/js/reschedule.js — перенос записи:
   GET /api/bookings/:id, GET /api/masters/:id/slots,
   PATCH /api/bookings/:id { startsAt }.
   Услуга и мастер фиксированы, старое время показано отдельно.
   ========================================================= */

"use strict";

(function () {
  var C = window.Cabinet;
  var T = window.BookingTime;
  var ID = parseInt(new URLSearchParams(window.location.search).get("id"), 10);

  var MESSAGE = document.getElementById("res-message");
  var LOADING = document.getElementById("reschedule-loading");
  var CONTENT = document.getElementById("reschedule-content");
  var FORM = document.getElementById("res-form");
  var SERVICE = document.getElementById("res-service");
  var MASTER = document.getElementById("res-master");
  var META = document.getElementById("res-meta");
  var CURRENT_DATE = document.getElementById("res-current-date");
  var CURRENT_TIME = document.getElementById("res-current-time");
  var PREVIEW = document.getElementById("res-preview");
  var PREVIEW_TEXT = document.getElementById("res-preview-text");
  var PREVIEW_META = document.getElementById("res-preview-meta");
  var HINT = document.getElementById("res-hint");
  var SUBMIT = document.getElementById("res-submit");
  var BACK_LINK = document.getElementById("res-back-link");
  var BACK = document.getElementById("res-back");

  var CAL_TITLE = document.getElementById("res-cal-title");
  var CAL_WEEKDAYS = document.getElementById("res-weekdays");
  var CALENDAR = document.getElementById("res-calendar");
  var CAL_PREV = document.getElementById("res-cal-prev");
  var CAL_NEXT = document.getElementById("res-cal-next");

  var SLOTS_LOADING = document.getElementById("res-slots-loading");
  var SLOTS_STATUS = document.getElementById("res-slots-status");
  var SLOTS = document.getElementById("res-slots");
  var NEAREST = document.getElementById("res-nearest");

  var state = {
    booking: null,
    today: "",
    month: null,
    selectedDate: "",
    slots: [],
    selectedSlot: null,
    loadingSlots: false,
    slotError: "",
    slotToken: 0,
    submitting: false,
  };

  function el(tag, className, text) {
    return C.el(tag, className, text);
  }

  function showMessage(text, kind) {
    MESSAGE.hidden = !text;
    MESSAGE.className = "reschedule-message" + (kind ? " is-" + kind : "");
    MESSAGE.textContent = text || "";
  }

  function showPageError(text) {
    LOADING.hidden = true;
    CONTENT.hidden = true;
    showMessage(text || "Не удалось загрузить запись.", "error");
  }

  function setHint(text, type) {
    HINT.textContent = text;
    HINT.className = "form-hint" + (type ? " " + type : "");
  }

  function statusText(text, isError) {
    SLOTS_STATUS.hidden = !text;
    SLOTS_STATUS.className = "slots-status" + (isError ? " is-error" : "");
    SLOTS_STATUS.textContent = text || "";
  }

  function sameSlot(a, b) {
    if (!a || !b) return false;
    if (a.startsAt && b.startsAt) return a.startsAt === b.startsAt;
    return a.time === b.time;
  }

  function isCurrent(slot) {
    var local = state.booking && state.booking.startsAtLocal;
    if (slot.startsAt && state.booking && slot.startsAt === state.booking.startsAt) {
      return true;
    }
    return !!(local && state.selectedDate === local.date && slot.time === local.time);
  }

  function currentDateLabel() {
    return C.fullDate(state.booking);
  }

  function renderSummary() {
    var booking = state.booking;
    SERVICE.textContent = (booking.service && booking.service.name) || "Услуга";
    MASTER.textContent = "Мастер: " + ((booking.master && booking.master.fullName) || "—");
    META.textContent = C.duration(booking) + " · " + C.price(booking);
    CURRENT_DATE.textContent = currentDateLabel();
    CURRENT_TIME.textContent = C.timeRange(booking);

    var detailsUrl = "booking-details.html?id=" + encodeURIComponent(booking.id);
    BACK_LINK.href = detailsUrl;
    BACK.href = detailsUrl;
  }

  function monthIndex(month) {
    return month.year * 12 + month.month - 1;
  }

  function todayMonthIndex() {
    var parsed = T.parseDate(state.today);
    if (!parsed) return Infinity;
    return parsed.y * 12 + parsed.m - 1;
  }

  function renderCalendar() {
    if (!state.month) return;
    CAL_TITLE.textContent = T.monthLabel(state.month.year, state.month.month);
    CAL_PREV.disabled = monthIndex(state.month) <= todayMonthIndex();

    CAL_WEEKDAYS.innerHTML = "";
    T.WEEKDAYS.forEach(function (day) {
      CAL_WEEKDAYS.appendChild(el("span", null, day));
    });

    CALENDAR.innerHTML = "";
    T.monthMatrix(state.month.year, state.month.month).forEach(function (week) {
      week.forEach(function (cell) {
        var button = el("button", "cal-cell", String(cell.day));
        button.type = "button";
        var disabled = !cell.inMonth || cell.date < state.today;

        if (!cell.inMonth) button.classList.add("is-other");
        if (cell.date < state.today) button.classList.add("is-past");
        if (cell.date === state.today) button.classList.add("is-today");
        if (cell.date === state.selectedDate) button.classList.add("is-selected");
        button.disabled = disabled;
        button.setAttribute("aria-label", T.humanDate(cell.date));
        if (cell.date === state.selectedDate) {
          button.setAttribute("aria-pressed", "true");
        } else {
          button.setAttribute("aria-pressed", "false");
        }

        if (!disabled) {
          button.addEventListener("click", function () {
            selectDate(cell.date);
          });
        }
        CALENDAR.appendChild(button);
      });
    });
  }

  function selectDate(date) {
    state.selectedDate = date;
    state.selectedSlot = null;
    renderCalendar();
    loadSlots(date);
  }

  function goToDate(date) {
    var parsed = T.parseDate(date);
    if (!parsed) return;
    state.month = { year: parsed.y, month: parsed.m };
    state.selectedDate = date;
    renderCalendar();
  }

  function renderSlots() {
    SLOTS.innerHTML = "";
    if (state.loadingSlots) return;
    if (state.slotError) {
      statusText("Не удалось загрузить время. " + state.slotError, true);
      return;
    }

    if (!state.slots.length) {
      statusText("На этот день свободного времени нет. Выберите другую дату.", false);
      return;
    }

    var hasFree = state.slots.some(function (slot) {
      return slot.available !== false && !isCurrent(slot);
    });
    if (!hasFree) {
      statusText("На этот день свободных окон нет — выберите другую дату.", false);
    } else {
      statusText("", false);
    }

    T.groupByPart(state.slots).forEach(function (group) {
      var wrap = el("div", "slot-group");
      wrap.appendChild(el("div", "slot-group-title", group.label));
      var grid = el("div", "slot-grid");

      group.slots.forEach(function (slot) {
        var busy = slot.available === false;
        var current = isCurrent(slot);
        var selected = sameSlot(state.selectedSlot, slot);
        var button = el("button", "slot-btn");
        button.type = "button";
        button.appendChild(el("span", "slot-time", slot.time));

        if (current) {
          button.classList.add("is-current");
          button.appendChild(el("span", "slot-note", "текущее"));
          button.disabled = true;
          button.title = "Текущее время записи";
        } else if (busy) {
          button.classList.add("is-busy");
          button.disabled = true;
          button.title = "Занято";
        } else {
          if (selected) {
            button.classList.add("is-selected");
            button.appendChild(el("span", "slot-note", "выбрано"));
          }
          button.addEventListener("click", function () {
            state.selectedSlot = slot;
            renderSlots();
            updateUi();
          });
        }

        grid.appendChild(button);
      });

      wrap.appendChild(grid);
      SLOTS.appendChild(wrap);
    });
  }

  function updateUi() {
    PREVIEW.hidden = true;

    if (state.loadingSlots) {
      setHint("Загружаем свободное время…");
      SUBMIT.disabled = true;
      return;
    }
    if (state.slotError) {
      setHint("Не удалось загрузить время. Выберите другую дату.", "is-error");
      SUBMIT.disabled = true;
      return;
    }
    if (!state.selectedDate) {
      setHint("Выберите новую дату.");
      SUBMIT.disabled = true;
      return;
    }
    if (!state.selectedSlot) {
      setHint(state.slots.length
        ? "Выберите свободное время из списка."
        : "На этот день окон нет — выберите другую дату.");
      SUBMIT.disabled = true;
      return;
    }

    PREVIEW.hidden = false;
    PREVIEW_TEXT.textContent = T.humanDate(state.selectedDate) + ", " + state.selectedSlot.time;
    PREVIEW_META.textContent = C.duration(state.booking);
    setHint("Новое время выбрано. Проверьте и подтвердите перенос.", "hint-ready");
    SUBMIT.disabled = state.submitting;
  }

  function loadSlots(date, preselect) {
    var token = state.slotToken + 1;
    state.slotToken = token;
    state.loadingSlots = true;
    state.slotError = "";
    state.slots = [];
    if (!preselect) state.selectedSlot = null;
    if (preselect) state.selectedSlot = preselect;

    SLOTS.innerHTML = "";
    SLOTS_LOADING.hidden = false;
    statusText("", false);
    NEAREST.hidden = true;
    updateUi();

    var masterId = state.booking.master && state.booking.master.id;
    var serviceId = state.booking.service && state.booking.service.id;
    if (!masterId || !serviceId) {
      state.loadingSlots = false;
      state.slotError = "В записи не хватает данных об услуге или мастере.";
      SLOTS_LOADING.hidden = true;
      renderSlots();
      updateUi();
      return;
    }

    window.API.getSlots(masterId, {
      date: date,
      serviceIds: [serviceId],
    }).then(function (data) {
      if (token !== state.slotToken) return;
      state.loadingSlots = false;
      state.slots = (data && data.slots) || [];
      SLOTS_LOADING.hidden = true;
      renderSlots();
      updateUi();
    }).catch(function (error) {
      if (token !== state.slotToken) return;
      state.loadingSlots = false;
      state.slotError = error.message || "Неизвестная ошибка.";
      SLOTS_LOADING.hidden = true;
      renderSlots();
      updateUi();
    });
  }

  function renderNearest(list) {
    NEAREST.innerHTML = "";
    if (!list || !list.length) {
      NEAREST.hidden = true;
      return;
    }

    NEAREST.hidden = false;
    NEAREST.appendChild(el("p", "nearest-title", "Ближайшее свободное время:"));
    var row = el("div", "nearest-time");

    list.forEach(function (item) {
      var chip = el("button", "nearest-slot",
        T.humanDate(item.date) + ", " + item.time);
      chip.type = "button";
      chip.addEventListener("click", function () {
        var slot = {
          startsAt: item.startsAt,
          endsAt: item.endsAt,
          time: item.time,
          available: true,
        };
        goToDate(item.date);
        state.selectedSlot = slot;
        renderCalendar();
        loadSlots(item.date, slot);
      });
      row.appendChild(chip);
    });

    NEAREST.appendChild(row);
  }

  async function submit() {
    if (!state.booking || !state.selectedSlot || state.submitting) return;
    state.submitting = true;
    SUBMIT.disabled = true;
    SUBMIT.textContent = "Переносим…";
    showMessage("", "");

    try {
      var result = await window.API.rescheduleBooking(state.booking.id, {
        startsAt: state.selectedSlot.startsAt,
      });
      var moved = result && result.booking ? result.booking : state.booking;
      window.location.assign(
        "booking-details.html?id=" + encodeURIComponent(moved.id) + "&moved=1"
      );
    } catch (error) {
      if (error.status === 401) {
        C.redirectToAuth();
        return;
      }
      showMessage(error.message || "Не удалось перенести запись.", "error");
      state.selectedSlot = null;
      renderSlots();
      updateUi();
      var nearest = error.details && error.details.nearestSlots;
      if (error.status === 409 && Array.isArray(nearest) && nearest.length) {
        renderNearest(nearest);
      }
    } finally {
      state.submitting = false;
      SUBMIT.textContent = "Перенести запись";
      SUBMIT.disabled = !state.selectedSlot;
    }
  }

  function inactiveText() {
    var status = state.booking.status;
    if (status === "cancelled") return "Эта запись отменена — перенести её нельзя.";
    if (status === "completed") return "Этот визит завершён — перенести его нельзя.";
    if (status === "no_show") return "Визит отмечен как несостоявшийся — перенести его нельзя.";
    return "Перенести можно только будущую активную запись.";
  }

  async function load() {
    if (!Number.isInteger(ID) || ID < 1) {
      showPageError("Не указан номер записи.");
      return;
    }

    try {
      await window.API.getMe();
    } catch (error) {
      if (error.status === 401) {
        C.redirectToAuth();
        return;
      }
      showPageError(error.message);
      return;
    }

    var results = await Promise.allSettled([
      window.API.getBooking(ID),
      window.API.getStudio(),
    ]);

    if (results[0].status !== "fulfilled") {
      var bookingError = results[0].reason;
      if (bookingError.status === 401) {
        C.redirectToAuth();
        return;
      }
      showPageError(bookingError.message);
      return;
    }

    var data = results[0].value;
    state.booking = data && data.booking;
    if (!state.booking) {
      showPageError("Запись не найдена.");
      return;
    }

    var timezone;
    if (results[1].status === "fulfilled") {
      var studio = results[1].value && results[1].value.studio;
      timezone = studio && studio.timezone;
    }
    state.today = T.todayInZone(timezone);

    LOADING.hidden = true;
    CONTENT.hidden = false;
    renderSummary();

    if (!C.isUpcoming(state.booking)) {
      FORM.hidden = true;
      showMessage(inactiveText(), "error");
      return;
    }

    FORM.hidden = false;
    var parts = C.dateParts(state.booking);
    var startDate = parts.date && parts.date >= state.today ? parts.date : state.today;
    var parsed = T.parseDate(startDate);
    if (!parsed) {
      showMessage("Не удалось определить дату записи.", "error");
      FORM.hidden = true;
      return;
    }

    state.month = { year: parsed.y, month: parsed.m };
    state.selectedDate = startDate;
    renderCalendar();
    loadSlots(startDate);
  }

  CAL_PREV.addEventListener("click", function () {
    if (!state.month) return;
    var moved = T.addMonths(state.month.year, state.month.month, -1);
    if (moved.year * 12 + moved.month - 1 < todayMonthIndex()) return;
    state.month = moved;
    renderCalendar();
  });

  CAL_NEXT.addEventListener("click", function () {
    if (!state.month) return;
    state.month = T.addMonths(state.month.year, state.month.month, 1);
    renderCalendar();
  });

  SUBMIT.addEventListener("click", submit);

  load();
})();
