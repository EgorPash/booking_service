/* =========================================================
   web/js/confirm.js — экран «Подтверждение записи» (Booking 04)
   и состояние «время заняли» (Booking 04b).

   Данные:
     GET  /api/auth/me, /api/services, /api/masters, /api/studio,
          /api/bookings/my
     POST /api/holds    — удержание выбранного слота + таймер
     POST /api/bookings — создание записи
   Ошибки показываем текстом из ответа API, свой текст не придумываем.
   ========================================================= */

"use strict";

(function () {
  var store = window.BookingStore;
  var T = window.BookingTime;
  var F = window.Format;
  var booking = store.booking;

  var RESULT_KEY = "lumi.booking.result";

  var NAME = document.getElementById("client-name");
  var PHONE = document.getElementById("client-phone");
  var EMAIL = document.getElementById("client-email");
  var COMMENT = document.getElementById("comment");
  var HINT = document.getElementById("client-hint");

  var SUMMARY_MASTER = document.getElementById("summary-master");
  var SUMMARY_DATE = document.getElementById("summary-date");
  var SUMMARY_TIME = document.getElementById("summary-time");
  var SUMMARY_SERVICES = document.getElementById("summary-services");
  var SUMMARY_DURATION = document.getElementById("summary-duration");
  var SUMMARY_TOTAL = document.getElementById("summary-total");

  var HOLD_LOADING = document.getElementById("hold-loading");
  var HOLD_BANNER = document.getElementById("hold-banner");
  var HOLD_LABEL = document.getElementById("hold-label");
  var HOLD_TIMER = document.getElementById("hold-timer");
  var HOLD_NOTE = document.getElementById("hold-note");
  var HOLD_EXPIRED = document.getElementById("hold-expired");
  var HOLD_REFRESH = document.getElementById("hold-refresh");

  var ERROR = document.getElementById("confirm-error");
  var CONFLICT = document.getElementById("conflict");
  var CONFLICT_MESSAGE = document.getElementById("conflict-message");
  var CONFLICT_NOTE = document.getElementById("conflict-note");
  var CONFLICT_SLOTS = document.getElementById("conflict-slots");

  var SUBMIT = document.getElementById("confirm-submit");

  var studioTz;
  var holdTimerId = null;
  var expiresMs = 0;
  var holdActive = false;
  var submitting = false;
  var leaving = false;

  /* ---------- Мелкие помощники ---------- */

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function setReadOnly(node, readOnly) {
    if (!node) return;
    node.readOnly = Boolean(readOnly);
    node.setAttribute("aria-readonly", readOnly ? "true" : "false");
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function showError(text) {
    if (!ERROR) return;
    ERROR.textContent = text;
    ERROR.hidden = false;
  }

  function clearError() {
    if (!ERROR) return;
    ERROR.textContent = "";
    ERROR.hidden = true;
  }

  function hideConflict() {
    show(CONFLICT, false);
    if (CONFLICT_SLOTS) CONFLICT_SLOTS.innerHTML = "";
  }

  function hideExpired() {
    show(HOLD_EXPIRED, false);
  }

  function showHoldLoading(visible) {
    show(HOLD_LOADING, visible);
    if (HOLD_REFRESH) HOLD_REFRESH.disabled = visible;
  }

  function firstMissingStep() {
    if (!booking.serviceIds.length) return 1;
    if (!booking.masterId) return 2;
    if (!booking.date) return 3;
    if (!booking.slot) return 4;
    return 0;
  }

  function goBooking(step) {
    window.location.replace("booking.html" + (step ? "?step=" + step : ""));
  }

  function authRedirect() {
    window.location.assign("auth.html?next=" + encodeURIComponent("confirm.html"));
  }

  /* ---------- Отрисовка ---------- */

  function renderClient(client) {
    var hasName = Boolean(client && client.fullName);
    var hasPhone = Boolean(client && client.phone);

    if (hasName) {
      NAME.value = client.fullName;
      NAME.placeholder = "";
    } else {
      NAME.value = "";
      NAME.placeholder = "Как к вам обращаться";
    }

    if (hasPhone) {
      PHONE.value = client.phone;
      PHONE.placeholder = "";
    } else {
      PHONE.value = "";
      PHONE.placeholder = "+7 900 000-00-00";
    }

    // Профиля клиента нет — поля заполняет сам клиент: сервер берёт их, чтобы
    // завести профиль. Профиль есть — поля только для чтения.
    var editable = !(hasName && hasPhone);
    setReadOnly(NAME, !editable);
    setReadOnly(PHONE, !editable);
    setText(
      HINT,
      editable
        ? "Профиля клиента нет — укажите имя и телефон, чтобы оформить запись."
        : "Имя и телефон берутся из профиля клиента."
    );
  }

  function endTimeSuffix() {
    if (!booking.slot || !booking.slot.endsAt || !studioTz) return "";
    var end = T.timeInZone(booking.slot.endsAt, studioTz);
    if (!end || end === booking.slot.time) return "";
    return " – " + end;
  }

  function renderSummary() {
    var master = store.masterById(booking.masterId);
    setText(SUMMARY_MASTER, master ? master.fullName : "—");
    setText(SUMMARY_DATE, booking.date ? T.humanDate(booking.date) : "—");
    setText(
      SUMMARY_TIME,
      booking.slot ? booking.slot.time + endTimeSuffix() : "—"
    );

    var services = store.getSelectedServices();
    SUMMARY_SERVICES.innerHTML = "";
    if (!services.length) {
      var empty = document.createElement("li");
      empty.className = "visit-service-name";
      empty.textContent = "—";
      SUMMARY_SERVICES.appendChild(empty);
    } else {
      services.forEach(function (service) {
        var item = document.createElement("li");
        var name = document.createElement("span");
        name.className = "visit-service-name";
        name.textContent = service.name;
        var price = document.createElement("span");
        price.className = "visit-service-price";
        price.textContent = F.price(service.priceMinor, service.currency);
        item.appendChild(name);
        item.appendChild(price);
        SUMMARY_SERVICES.appendChild(item);
      });
    }

    var totals = store.totals();
    setText(SUMMARY_DURATION, F.duration(totals.durationMin));
    setText(SUMMARY_TOTAL, F.price(totals.priceMinor, totals.currency));
  }

  function refreshSubmit() {
    SUBMIT.disabled = submitting || !holdActive || !booking.slot;
    SUBMIT.textContent = submitting ? "Подтверждаем запись…" : "Подтвердить запись";
  }

  function setSubmitting(value) {
    submitting = value;
    refreshSubmit();
  }

  /* ---------- Таймер удержания ---------- */

  function renderTimer() {
    var left = expiresMs - Date.now();

    if (left <= 0) {
      setText(HOLD_TIMER, "00:00");
      HOLD_BANNER.classList.add("is-low");
      stopTimer();
      expireHold();
      return;
    }

    var total = Math.ceil(left / 1000);
    setText(HOLD_TIMER, pad2(Math.floor(total / 60)) + ":" + pad2(total % 60));

    var low = left < 60000;
    HOLD_BANNER.classList.toggle("is-low", low);
    setText(
      HOLD_LABEL,
      low ? "Слот удерживается — меньше минуты" : "Слот удерживается"
    );
    setText(HOLD_NOTE, low
      ? "Скоро время удержания истечёт."
      : "Завершите оформление, пока время не истекло.");
  }

  function stopTimer() {
    if (holdTimerId) {
      clearInterval(holdTimerId);
      holdTimerId = null;
    }
  }

  function startTimer() {
    stopTimer();
    renderTimer();
    if (holdActive) holdTimerId = setInterval(renderTimer, 1000);
  }

  function applyHold(expiresAt) {
    holdActive = true;
    expiresMs = new Date(expiresAt).getTime();
    HOLD_BANNER.classList.remove("is-low");
    showHoldLoading(false);
    show(HOLD_BANNER, true);
    hideExpired();
    hideConflict();
    setText(HOLD_LABEL, "Слот удерживается");
    startTimer();
    setSubmitting(false);
  }

  function expireHold() {
    holdActive = false;
    store.clearHold();
    HOLD_BANNER.classList.add("is-low");
    setText(HOLD_LABEL, "Время удержания истекло");
    setText(HOLD_TIMER, "00:00");
    setText(HOLD_NOTE, "Обновите удержание или выберите другое время.");
    show(HOLD_EXPIRED, true);
    refreshSubmit();
  }

  /* ---------- Ошибки API ---------- */

  function handleHoldError(error) {
    showHoldLoading(false);
    if (error.status === 401) {
      authRedirect();
      return;
    }

    holdActive = false;
    stopTimer();
    show(HOLD_BANNER, false);
    refreshSubmit();

    if (error.status === 409) {
      showConflict(error.message, []);
      return;
    }

    showError(error.message);
  }

  function handleBookingError(error) {
    if (error.status === 401) {
      authRedirect();
      return;
    }

    setSubmitting(false);

    if (error.status === 409) {
      // Слот заняли: удержание больше недействительно.
      holdActive = false;
      store.clearHold();
      stopTimer();
      show(HOLD_BANNER, false);
      hideExpired();
      clearError();

      var nearest =
        error.details && Array.isArray(error.details.nearestSlots)
          ? error.details.nearestSlots
          : [];
      showConflict(error.message, nearest);
      refreshSubmit();
      return;
    }

    showError(error.message);
  }

  /* ---------- Booking 04b ---------- */

  function showConflict(message, nearest) {
    show(CONFLICT, true);
    setText(CONFLICT_MESSAGE, message);
    CONFLICT_SLOTS.innerHTML = "";

    var list = Array.isArray(nearest) ? nearest : [];
    setText(
      CONFLICT_NOTE,
      list.length
        ? "Сервер предложил ближайшие свободные варианты."
        : "Выберите другое время в календаре."
    );

    list.forEach(function (slot) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "nearest-chip";
      button.textContent = T.humanDate(slot.date) + ", " + slot.time;
      button.addEventListener("click", function () {
        chooseNearest(slot, button);
      });
      CONFLICT_SLOTS.appendChild(button);
    });

    show(CONFLICT_SLOTS, list.length > 0);
  }

  function chooseNearest(slot) {
    if (!slot || !slot.startsAt) return;

    Array.prototype.forEach.call(
      CONFLICT_SLOTS.querySelectorAll(".nearest-chip"),
      function (chip) {
        chip.disabled = true;
      }
    );

    store.setDate(slot.date || booking.date);
    store.setSlot({
      startsAt: slot.startsAt,
      endsAt: slot.endsAt || "",
      time: slot.time || "",
    });

    renderSummary();
    hideConflict();
    clearError();
    createHold();
  }

  /* ---------- Удержание ---------- */

  function holdMatchesSlot() {
    return Boolean(
      booking.holdId &&
      booking.holdStartsAt &&
      booking.slot &&
      booking.holdStartsAt === booking.slot.startsAt
    );
  }

  async function ensureHold() {
    showHoldLoading(true);
    hideConflict();
    hideExpired();
    clearError();

    if (holdMatchesSlot()) {
      try {
        var existing = await window.API.getHold(booking.holdId);
        if (
          existing &&
          existing.active &&
          new Date(existing.expiresAt).getTime() > Date.now()
        ) {
          store.setHold(
            existing.holdId || booking.holdId,
            existing.startsAt || booking.holdStartsAt,
            existing.expiresAt
          );
          applyHold(existing.expiresAt);
          return;
        }
      } catch (error) {
        if (error.status === 401) {
          authRedirect();
          return;
        }
        // Удержание истекло или не найдено — создаём новое.
      }
    }

    createHold();
  }

  async function createHold() {
    showHoldLoading(true);
    hideConflict();
    hideExpired();
    clearError();

    try {
      var hold = await window.API.createHold({
        masterId: Number(booking.masterId),
        serviceIds: booking.serviceIds.slice(),
        startsAt: booking.slot.startsAt,
      });
      store.setHold(hold.holdId, hold.startsAt, hold.expiresAt);
      applyHold(hold.expiresAt);
    } catch (error) {
      handleHoldError(error);
    }
  }

  /* ---------- Подтверждение ---------- */

  function saveResult(response, comment) {
    var services = store.getSelectedServices().map(function (service) {
      return {
        id: service.id,
        name: service.name,
        priceMinor: service.priceMinor,
        durationMin: service.durationMin,
        currency: service.currency,
      };
    });
    var master = store.masterById(booking.masterId);

    var snapshot = {
      bookingIds: (response.bookings || [])
        .map(function (row) {
          return row.id;
        })
        .filter(Boolean),
      startsAt: response.startsAt,
      endsAt: response.endsAt,
      durationMin: response.durationMin,
      priceMinor: response.priceMinor,
      currency: response.currency,
      date: booking.date,
      time: booking.slot ? booking.slot.time : "",
      comment: comment || null,
      timezone: studioTz || null,
      masterName: master ? master.fullName : "",
      services: services,
    };

    try {
      sessionStorage.setItem(RESULT_KEY, JSON.stringify(snapshot));
    } catch (error) {
      // без снимка экран успеха не откроется — это редкий случай
    }
  }

  async function submit() {
    if (!holdActive || !booking.slot) return;

    clearError();
    hideConflict();
    setSubmitting(true);

    var payload = {
      masterId: Number(booking.masterId),
      serviceIds: booking.serviceIds.slice(),
      startsAt: booking.slot.startsAt,
      holdToken: booking.holdId,
    };

    var comment = COMMENT.value.trim();
    if (comment) payload.comment = comment;

    // Профиля клиента нет — сервер возьмёт имя и телефон отсюда, чтобы
    // завести профиль. Если профиль есть, сервер использует свой.
    var fullName = NAME.value.trim();
    var phone = PHONE.value.trim();
    if (fullName) payload.fullName = fullName;
    if (phone) payload.phone = phone;

    try {
      var response = await window.API.createBooking(payload);
      saveResult(response, comment);
      store.reset();
      leaving = true;
      window.location.assign("success.html");
    } catch (error) {
      handleBookingError(error);
    }
  }

  /* ---------- Уход со страницы ---------- */

  async function leave(url) {
    if (leaving || submitting) return;
    leaving = true;

    if (booking.holdId) {
      try {
        await window.API.releaseHold(booking.holdId);
      } catch (error) {
        // Удержание могло истечь — уйти всё равно можно.
      }
      store.clearHold();
    }

    window.location.assign(url);
  }

  /* ---------- Загрузка ---------- */

  async function init() {
    var missing = firstMissingStep();
    if (missing) {
      goBooking(missing);
      return;
    }

    renderSummary();
    SUBMIT.disabled = true;

    var me;
    try {
      me = await window.API.getMe();
    } catch (error) {
      if (error.status === 401) {
        authRedirect();
        return;
      }
      setSubmitting(false);
      showError(error.message);
      return;
    }

    EMAIL.value = (me && me.user && me.user.email) || "";

    var results = await Promise.allSettled([
      window.API.getServices(),
      window.API.getMasters(),
      window.API.getStudio(),
      window.API.getMyBookings(),
    ]);

    var servicesResult = results[0];
    var mastersResult = results[1];
    var studioResult = results[2];
    var bookingsResult = results[3];

    if (servicesResult.status === "fulfilled") {
      store.setServices(
        (servicesResult.value && servicesResult.value.services) || []
      );
    }
    if (mastersResult.status === "fulfilled") {
      store.setMasters(
        (mastersResult.value && mastersResult.value.masters) || []
      );
    }
    if (studioResult.status === "fulfilled") {
      var studio = studioResult.value && studioResult.value.studio;
      studioTz = studio && studio.timezone ? studio.timezone : undefined;
    }

    var client = (me && me.client) || null;
    if (!client && bookingsResult.status === "fulfilled") {
      var list =
        (bookingsResult.value && bookingsResult.value.bookings) || [];
      for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].client) {
          client = list[i].client;
          break;
        }
      }
    }
    renderClient(client);

    if (servicesResult.status === "rejected") {
      setSubmitting(false);
      showError(servicesResult.reason.message);
      return;
    }
    if (mastersResult.status === "rejected") {
      setSubmitting(false);
      showError(mastersResult.reason.message);
      return;
    }

    var master = store.masterById(booking.masterId);
    if (!store.getSelectedServices().length) {
      setSubmitting(false);
      showError("Выбранные услуги больше недоступны — выберите услуги заново.");
      return;
    }
    if (!master || !store.masterCanServe(master)) {
      setSubmitting(false);
      showError("Выбранный мастер больше не оказывает эти услуги — выберите мастера заново.");
      return;
    }

    renderSummary();
    await ensureHold();
  }

  /* ---------- События ---------- */

  SUBMIT.addEventListener("click", submit);
  HOLD_REFRESH.addEventListener("click", ensureHold);

  Array.prototype.forEach.call(
    document.querySelectorAll("[data-leave]"),
    function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        leave(link.getAttribute("href"));
      });
    }
  );

  init();
})();
