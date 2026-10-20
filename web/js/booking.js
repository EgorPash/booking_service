/* =========================================================
   web/js/booking.js — экран «Запись», шаги 1–4.
   Данные берём только через window.API (js/api.js), выбор храним
   в window.BookingStore (js/store.js), календарь/группировку
   считает window.BookingTime (js/booking-time.js).
   Шаг 1 — мультивыбор услуг, шаг 2 — мастер, шаг 3 — дата,
   шаг 4 — время. Свободные окна и занятые интервалы приходят
   из API; сами доступность не вычисляем.
   ========================================================= */

"use strict";

(function () {
  var store = window.BookingStore;
  var T = window.BookingTime;

  var SERVICES_LIST = document.getElementById("services-list");
  var MASTERS_LIST = document.getElementById("masters-list");
  var PANEL_1 = document.querySelector('[data-panel="1"]');
  var PANEL_2 = document.querySelector('[data-panel="2"]');
  var PANEL_3 = document.querySelector('[data-panel="3"]');
  var PANEL_4 = document.querySelector('[data-panel="4"]');

  var CAL_TITLE = document.getElementById("calendar-title");
  var CAL_PREV = document.getElementById("calendar-prev");
  var CAL_NEXT = document.getElementById("calendar-next");
  var CAL_WEEKDAYS = document.getElementById("calendar-weekdays");
  var CAL_GRID = document.getElementById("calendar-grid");
  var CAL_STATUS = document.getElementById("calendar-status");

  var SLOTS_LOADING = document.getElementById("slots-loading");
  var SLOTS_STATUS = document.getElementById("slots-status");
  var SLOTS_LIST = document.getElementById("slots-list");
  var SLOTS_END = document.getElementById("slots-end");
  var NEAREST = document.getElementById("nearest-box");

  var STEP_BUTTONS = Array.prototype.slice.call(document.querySelectorAll(".step-btn"));
  var SUMMARY_SERVICES = document.getElementById("summary-services");
  var SUMMARY_DURATION = document.getElementById("summary-duration");
  var SUMMARY_PRICE = document.getElementById("summary-price");
  var HINT = document.getElementById("booking-hint");
  var NEXT_BUTTON = document.getElementById("next-button");
  var BACK_BUTTON = document.getElementById("back-button");

  var SERVICE_ICON =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>' +
    '<circle cx="12" cy="12" r="4"/></svg>';

  var CHECK_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="3" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

  var currentStep = 1;
  var maxReached = 1;
  var servicesState = "loading";
  var servicesError = "";
  var mastersState = "loading";
  var mastersError = "";
  var studioTz;
  var today = "";

  var calendar = { year: 0, month: 0, loading: false, error: "" };
  var dayCache = {};
  var nearestToken = 0;

  /* ---------- Форматирование и разметка ---------- */

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function formatDuration(min) {
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

  function formatPrice(priceMinor, currency) {
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

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function initial(fullName) {
    var text = String(fullName || "").trim();
    return text ? text.charAt(0).toUpperCase() : "?";
  }

  function showListMessage(container, className, text) {
    container.innerHTML = "";
    container.appendChild(el("p", className, text));
  }

  function showText(node, baseClass, text, isError) {
    node.textContent = text;
    node.className = baseClass + (isError ? " is-error" : "");
    node.hidden = false;
  }

  function hideNode(node) {
    node.hidden = true;
    node.textContent = "";
  }

  /* ---------- Шаг 1. Услуги ---------- */

  function skeletonServices() {
    SERVICES_LIST.innerHTML = "";
    for (var i = 0; i < 3; i += 1) {
      SERVICES_LIST.appendChild(el("div", "skeleton skeleton-option"));
    }
  }

  function renderServices() {
    if (servicesState === "loading") {
      skeletonServices();
      return;
    }
    if (servicesState === "error") {
      showListMessage(SERVICES_LIST, "data-error",
        "Не удалось загрузить услуги. " + servicesError);
      return;
    }

    var services = store.state.services;
    if (!services.length) {
      showListMessage(SERVICES_LIST, "data-empty",
        "Пока нет доступных услуг. Загляните позже.");
      return;
    }

    SERVICES_LIST.innerHTML = "";
    services.forEach(function (service) {
      var selected = store.hasService(service.id);

      var option = el("button", "option-btn service-option");
      option.type = "button";
      option.setAttribute("role", "checkbox");
      option.setAttribute("aria-checked", selected ? "true" : "false");
      if (selected) option.classList.add("selected");

      var icon = el("span", "service-option-icon");
      icon.innerHTML = SERVICE_ICON;
      option.appendChild(icon);

      var info = el("span", "service-option-info");
      info.appendChild(el("span", "service-option-name", service.name));
      info.appendChild(el("span", "service-option-meta",
        formatDuration(service.durationMin) + " · " +
        formatPrice(service.priceMinor, service.currency)));
      option.appendChild(info);

      var check = el("span", "option-check");
      check.innerHTML = CHECK_ICON;
      option.appendChild(check);

      option.addEventListener("click", function () {
        store.toggleService(service.id);
        syncMasterWithServices();
        invalidateAvailability();
        renderServices();
        renderMasters();
        updateSummary();
        updateView();
      });

      SERVICES_LIST.appendChild(option);
    });
  }

  /* ---------- Шаг 2. Мастера ---------- */

  function missingServiceNames(master) {
    var set = master.serviceIds || [];
    return store.booking.serviceIds
      .filter(function (id) {
        return set.indexOf(id) === -1;
      })
      .map(function (id) {
        var service = store.serviceById(id);
        return service ? service.name : "#" + id;
      })
      .join(", ");
  }

  function syncMasterWithServices() {
    var id = store.booking.masterId;
    if (!id) return;
    var master = store.masterById(id);
    if (!master || !store.masterCanServe(master)) {
      store.setMasterId("");
    }
  }

  function skeletonMasters() {
    MASTERS_LIST.innerHTML = "";
    for (var i = 0; i < 3; i += 1) {
      MASTERS_LIST.appendChild(el("div", "skeleton skeleton-master"));
    }
  }

  function renderMasters() {
    if (mastersState === "loading") {
      skeletonMasters();
      return;
    }
    if (mastersState === "error") {
      showListMessage(MASTERS_LIST, "data-error",
        "Не удалось загрузить мастеров. " + mastersError);
      return;
    }

    var masters = store.state.masters;
    if (!masters.length) {
      showListMessage(MASTERS_LIST, "data-empty", "Список мастеров пока пуст.");
      return;
    }

    MASTERS_LIST.innerHTML = "";
    masters.forEach(function (master) {
      var capable = store.masterCanServe(master);
      var selected = String(store.booking.masterId) === String(master.id);

      var option = el("button", "option-btn master-btn");
      option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) option.classList.add("selected");

      option.appendChild(el("span", "avatar", initial(master.fullName)));
      option.appendChild(el("span", "option-name", master.fullName));
      if (master.title) {
        option.appendChild(el("span", "option-role", master.title));
      }

      if (!capable) {
        option.disabled = true;
        option.classList.add("is-disabled");
        option.title = "Не оказывает: " + missingServiceNames(master);
        option.appendChild(el("span", "option-note", "Не оказывает выбранные услуги"));
      }

      var check = el("span", "option-check");
      check.innerHTML = CHECK_ICON;
      option.appendChild(check);

      option.addEventListener("click", function () {
        if (option.disabled) return;
        store.setMasterId(master.id);
        invalidateAvailability();
        renderMasters();
        updateView();
      });

      MASTERS_LIST.appendChild(option);
    });
  }

  /* ---------- Итог по услугам ---------- */

  function updateSummary() {
    var services = store.getSelectedServices();

    if (!services.length) {
      SUMMARY_SERVICES.textContent = "Услуги не выбраны";
      SUMMARY_DURATION.textContent = "0 минут";
      SUMMARY_PRICE.textContent = "—";
      return;
    }

    SUMMARY_SERVICES.textContent = services
      .map(function (service) {
        return service.name;
      })
      .join(", ");

    var totals = store.totals();
    SUMMARY_DURATION.textContent = formatDuration(totals.durationMin);
    SUMMARY_PRICE.textContent = formatPrice(totals.priceMinor, totals.currency);
  }

  /* ---------- Доступность: кэш по дням ---------- */

  function dayInfoFrom(data) {
    var slots = (data && data.slots) || [];
    var free = slots.filter(function (slot) {
      return slot.available !== false;
    });
    return {
      status: "ready",
      isWorking: data && typeof data.isWorking === "boolean" ? data.isWorking : null,
      slots: slots,
      freeCount: free.length,
      timezone: (data && data.timezone) || studioTz,
      durationMin: data && data.durationMin,
      priceMinor: data && data.priceMinor,
      currency: data && data.currency,
    };
  }

  function loadDay(date, force) {
    if (!force && dayCache[date] && dayCache[date].status === "ready") {
      return Promise.resolve(dayCache[date]);
    }
    dayCache[date] = { status: "loading" };
    return window.API
      .getSlots(store.booking.masterId, { date: date, serviceIds: store.booking.serviceIds })
      .then(function (data) {
        dayCache[date] = dayInfoFrom(data);
        return dayCache[date];
      })
      .catch(function (error) {
        dayCache[date] = { status: "error", error: error.message };
        throw error;
      });
  }

  function mapPool(items, limit, worker) {
    var index = 0;
    var runners = [];
    for (var i = 0; i < Math.min(limit, items.length); i += 1) runners.push(run());
    function run() {
      if (index >= items.length) return Promise.resolve();
      var item = items[index];
      index += 1;
      return Promise.resolve(worker(item)).then(run);
    }
    return Promise.all(runners);
  }

  /* ---------- Шаг 3. Календарь ---------- */

  function initCalendar() {
    var base = T.parseDate(store.booking.date) || T.parseDate(today) || { y: 2026, m: 1 };
    calendar.year = base.y;
    calendar.month = base.m;
  }

  function loadMonth() {
    if (!store.booking.masterId || !store.booking.serviceIds.length) {
      calendar.loading = false;
      renderCalendar();
      return;
    }
    calendar.loading = true;
    calendar.error = "";
    renderCalendar();

    var weeks = T.monthMatrix(calendar.year, calendar.month);
    var dates = [];
    weeks.forEach(function (week) {
      week.forEach(function (cell) {
        if (!cell.inMonth || cell.date < today) return;
        var cached = dayCache[cell.date];
        if (!cached || cached.status === "error") dates.push(cell.date);
      });
    });

    mapPool(dates, 4, function (date) {
      return loadDay(date).catch(function () {
        return null;
      }).then(function () {
        renderCalendar();
      });
    }).then(function () {
      calendar.loading = false;
      renderCalendar();
      if (currentStep === 3) updateHint();
    });
  }

  function renderCalendar() {
    if (!calendar.year) initCalendar();
    CAL_TITLE.textContent = T.monthLabel(calendar.year, calendar.month);

    var todayParts = T.parseDate(today);
    CAL_PREV.disabled = !!(todayParts && calendar.year === todayParts.y && calendar.month === todayParts.m);

    if (!CAL_WEEKDAYS.childElementCount) {
      T.WEEKDAYS.forEach(function (label) {
        CAL_WEEKDAYS.appendChild(el("span", null, label));
      });
    }

    CAL_GRID.innerHTML = "";
    var weeks = T.monthMatrix(calendar.year, calendar.month);
    weeks.forEach(function (week) {
      week.forEach(function (cell) {
        var button = el("button", "cal-cell");
        button.type = "button";
        button.textContent = String(cell.day);
        var disabled = true;

        if (!cell.inMonth) {
          button.classList.add("is-other");
        } else if (cell.date < today) {
          button.classList.add("is-past");
          button.title = "Прошедший день";
        } else {
          var info = dayCache[cell.date];
          if (info && info.status === "ready") {
            if (info.isWorking === false) {
              button.classList.add("is-off");
              button.title = "Мастер не работает в этот день";
            } else {
              disabled = false;
              if (info.freeCount > 0) {
                button.classList.add("is-free");
              } else {
                button.classList.add("is-full");
                button.title = "Свободных окон нет — покажем ближайшее";
              }
            }
          } else if (info && info.status === "error") {
            button.classList.add("is-off");
            button.title = "Не удалось загрузить день";
          } else {
            button.classList.add("is-loading-day");
            button.title = "Загрузка…";
          }
        }

        if (cell.date === today) button.classList.add("is-today");
        if (cell.date === store.booking.date) button.classList.add("is-selected");
        button.disabled = disabled;
        if (!disabled) {
          button.addEventListener("click", function () {
            selectDate(cell.date);
          });
        }
        CAL_GRID.appendChild(button);
      });
    });

    if (calendar.loading) {
      showText(CAL_STATUS, "calendar-status", "Загружаем свободные дни…", false);
    } else if (calendar.error) {
      showText(CAL_STATUS, "calendar-status", calendar.error, true);
    } else if (!store.booking.masterId) {
      showText(CAL_STATUS, "calendar-status", "Сначала выберите мастера.", false);
    } else {
      hideNode(CAL_STATUS);
    }
  }

  function selectDate(date) {
    store.setDate(date);
    maxReached = 4;
    renderCalendar();
    goToStep(4);
  }

  /* ---------- Шаг 4. Время ---------- */

  function resetSlotsArea() {
    SLOTS_LOADING.hidden = true;
    hideNode(SLOTS_STATUS);
    hideNode(SLOTS_END);
    NEAREST.hidden = true;
    NEAREST.innerHTML = "";
    SLOTS_LIST.innerHTML = "";
  }

  function loadSlotsForDate(date) {
    resetSlotsArea();
    if (!date) {
      showText(SLOTS_STATUS, "slots-status", "Сначала выберите дату на шаге 3.", false);
      if (currentStep === 4) updateHint();
      return;
    }

    var cached = dayCache[date];
    if (cached && cached.status === "ready") {
      renderSlotsGrid(cached, date);
      if (currentStep === 4) updateHint();
      return;
    }

    SLOTS_LOADING.hidden = false;
    if (currentStep === 4) updateHint();
    loadDay(date)
      .then(function (info) {
        SLOTS_LOADING.hidden = true;
        renderCalendar();
        renderSlotsGrid(info, date);
        if (currentStep === 4) updateHint();
      })
      .catch(function (error) {
        SLOTS_LOADING.hidden = true;
        showText(SLOTS_STATUS, "slots-status",
          "Не удалось загрузить время. " + error.message, true);
        if (currentStep === 4) updateHint();
      });
  }

  function renderSlotsGrid(info, date) {
    resetSlotsArea();
    var info2 = info;

    // Выбранное ранее окно могло исчезнуть (его заняли) — снимаем выбор.
    if (store.booking.slot) {
      var stillFree = (info2.slots || []).some(function (slot) {
        return slot.available !== false && slot.startsAt === store.booking.slot.startsAt;
      });
      if (!stillFree) store.setSlot(null);
    }

    if (info2.freeCount === 0) {
      showNearest(date);
      return;
    }

    var groups = T.groupByPart(info2.slots);
    if (!groups.length) {
      showNearest(date);
      return;
    }

    groups.forEach(function (group) {
      var wrap = el("div", "slot-group");
      wrap.appendChild(el("div", "slot-group-title", group.label));
      var grid = el("div", "slot-grid");

      group.slots.forEach(function (slot) {
        var busy = slot.available === false;
        var button = el("button", "slot-btn" + (busy ? " is-busy" : ""));
        button.type = "button";
        button.textContent = slot.time;

        if (busy) {
          button.disabled = true;
          button.title = "Занято";
        } else {
          if (store.booking.slot && store.booking.slot.startsAt === slot.startsAt) {
            button.classList.add("is-selected");
          }
          button.addEventListener("click", function () {
            store.setSlot({ startsAt: slot.startsAt, endsAt: slot.endsAt, time: slot.time });
            renderSlotsGrid(info2, date);
            updateHint();
          });
        }
        grid.appendChild(button);
      });

      wrap.appendChild(grid);
      SLOTS_LIST.appendChild(wrap);
    });

    renderEnd(info2, date);
  }

  function renderEnd(info, date) {
    var slot = store.booking.slot;
    if (!slot) return;
    var endTime = T.timeInZone(slot.endsAt, info.timezone || studioTz);
    SLOTS_END.textContent = T.humanDate(date) + " · визит закончится в " + endTime;
    SLOTS_END.hidden = false;
  }

  function showNearest(date) {
    var token = (nearestToken += 1);
    renderNearestBox(date, { state: "loading" });
    findNearest(date).then(function (result) {
      if (token !== nearestToken) return;
      renderNearestBox(date, result);
    });
  }

  function findNearest(date) {
    var results = { state: "empty" };
    var day = date;
    var i = 0;

    function step() {
      i += 1;
      if (i > 30) return Promise.resolve(results);
      day = T.addDays(date, i);
      var cached = dayCache[day];
      var chain = cached && cached.status === "ready"
        ? Promise.resolve(cached)
        : loadDay(day).catch(function () {
            return null;
          });
      return chain.then(function (info) {
        if (info && info.freeCount > 0) {
          var firstFree = info.slots.filter(function (slot) {
            return slot.available !== false;
          })[0];
          results = { state: "ready", date: day, slot: firstFree };
          return results;
        }
        return step();
      });
    }

    return step();
  }

  function renderNearestBox(date, state) {
    NEAREST.hidden = false;
    NEAREST.innerHTML = "";
    NEAREST.appendChild(el("p", "nearest-title",
      "На " + T.humanDate(date) + " свободного времени нет."));

    if (state.state === "loading") {
      var loading = el("div", "slots-loading");
      loading.appendChild(el("span", "spinner"));
      loading.appendChild(document.createTextNode("Ищем ближайшее свободное время…"));
      NEAREST.appendChild(loading);
    } else if (state.state === "ready") {
      var row = el("div", "nearest-time");
      row.appendChild(el("span", "nearest-label", "Ближайшее свободное окно:"));
      var button = el("button", "nearest-slot", T.humanDate(state.date) + ", " + state.slot.time);
      button.type = "button";
      button.addEventListener("click", function () {
        selectDate(state.date);
      });
      row.appendChild(button);
      NEAREST.appendChild(row);
    } else if (state.state === "empty") {
      NEAREST.appendChild(el("p", "nearest-hint", "Ближайших свободных окон не нашлось."));
    } else {
      NEAREST.appendChild(el("p", "nearest-hint is-error", "Не удалось найти ближайшее время."));
    }

    var hints = el("ul", "nearest-hints");
    [
      "Выберите другую дату в календаре.",
      "Запишитесь к другому мастеру.",
      "Уменьшите количество услуг.",
    ].forEach(function (text) {
      hints.appendChild(el("li", null, text));
    });
    NEAREST.appendChild(hints);
  }

  /* ---------- Инвалидация при смене услуг/мастера ---------- */

  function invalidateAvailability() {
    dayCache = {};
    calendar.loading = false;
    calendar.error = "";
    nearestToken += 1;
    maxReached = currentStep;
  }

  /* ---------- Индикатор шагов, подсказка, кнопки ---------- */

  function setHint(text, type) {
    HINT.textContent = text;
    HINT.className = "form-hint" + (type ? " " + type : "");
  }

  function updateStepper() {
    STEP_BUTTONS.forEach(function (button) {
      var step = Number(button.dataset.step);
      button.classList.remove("is-active", "is-done", "is-future");
      if (step === currentStep) {
        button.classList.add("is-active");
      } else if (step <= maxReached) {
        button.classList.add("is-done");
      } else {
        button.classList.add("is-future");
      }
      button.disabled = step > maxReached;
    });
  }

  function updateView() {
    updateStepper();
    PANEL_1.hidden = currentStep !== 1;
    PANEL_2.hidden = currentStep !== 2;
    PANEL_3.hidden = currentStep !== 3;
    PANEL_4.hidden = currentStep !== 4;
    BACK_BUTTON.textContent = ["", "На главную", "К услугам", "К мастеру", "К дате"][currentStep];
    updateHint();
  }

  function updateHint() {
    if (currentStep === 1) {
      var chosen = store.booking.serviceIds.length;
      if (servicesState === "loading") {
        setHint("Загружаем услуги…");
        NEXT_BUTTON.disabled = true;
      } else if (servicesState === "error") {
        setHint("Не удалось загрузить услуги. " + servicesError, "is-error");
        NEXT_BUTTON.disabled = true;
      } else if (!store.state.services.length) {
        setHint("Услуги пока недоступны.");
        NEXT_BUTTON.disabled = true;
      } else if (!chosen) {
        setHint("Выберите хотя бы одну услугу, чтобы продолжить.");
        NEXT_BUTTON.disabled = true;
      } else {
        setHint("Выбрано услуг: " + chosen + ". Можно перейти к выбору мастера.", "hint-ready");
        NEXT_BUTTON.disabled = false;
      }
      return;
    }

    if (currentStep === 2) {
      var capable = store.state.masters.some(function (master) {
        return store.masterCanServe(master);
      });
      if (mastersState === "loading") {
        setHint("Загружаем мастеров…");
        NEXT_BUTTON.disabled = true;
      } else if (mastersState === "error") {
        setHint("Не удалось загрузить мастеров. " + mastersError, "is-error");
        NEXT_BUTTON.disabled = true;
      } else if (!capable) {
        setHint("Нет мастеров, оказывающих выбранные услуги.");
        NEXT_BUTTON.disabled = true;
      } else if (!store.booking.masterId) {
        setHint("Выберите мастера, чтобы перейти к выбору даты.");
        NEXT_BUTTON.disabled = true;
      } else {
        setHint("Мастер выбран. Переходите к выбору даты.", "hint-ready");
        NEXT_BUTTON.disabled = false;
      }
      return;
    }

    if (currentStep === 3) {
      if (!store.booking.masterId) {
        setHint("Сначала выберите мастера.");
        NEXT_BUTTON.disabled = true;
      } else if (calendar.loading) {
        setHint("Загружаем свободные дни…");
        NEXT_BUTTON.disabled = true;
      } else if (calendar.error) {
        setHint(calendar.error, "is-error");
        NEXT_BUTTON.disabled = true;
      } else if (!store.booking.date) {
        setHint("Выберите день со свободными окнами.");
        NEXT_BUTTON.disabled = true;
      } else {
        setHint("Дата выбрана: " + T.humanDate(store.booking.date) + ". Переходите к выбору времени.", "hint-ready");
        NEXT_BUTTON.disabled = false;
      }
      return;
    }

    // Шаг 4
    var date = store.booking.date;
    var info = date ? dayCache[date] : null;
    if (!date) {
      setHint("Сначала выберите дату.");
      NEXT_BUTTON.disabled = true;
    } else if (SLOTS_LOADING.hidden === false) {
      setHint("Загружаем свободное время…");
      NEXT_BUTTON.disabled = true;
    } else if (SLOTS_STATUS && SLOTS_STATUS.hidden === false) {
      setHint(SLOTS_STATUS.textContent, "is-error");
      NEXT_BUTTON.disabled = true;
    } else if (!info || info.status !== "ready") {
      setHint("Выберите дату заново.");
      NEXT_BUTTON.disabled = true;
    } else if (info.freeCount === 0) {
      setHint("На этот день свободного времени нет — смотрите ближайшее ниже.");
      NEXT_BUTTON.disabled = true;
    } else if (!store.booking.slot) {
      setHint("Выберите время из свободных окон.");
      NEXT_BUTTON.disabled = true;
    } else {
      setHint("Время выбрано. Проверьте данные и подтвердите запись.", "hint-ready");
      NEXT_BUTTON.disabled = false;
    }
  }

  /* ---------- Навигация ---------- */

  function enterStep(step) {
    if (step === 3) {
      if (!calendar.year) initCalendar();
      loadMonth();
    } else if (step === 4) {
      loadSlotsForDate(store.booking.date);
    }
  }

  function goToStep(step) {
    if (step < 1 || step > 4) return;
    if (step > maxReached) maxReached = step;
    currentStep = step;
    updateView();
    enterStep(step);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  STEP_BUTTONS.forEach(function (button) {
    button.addEventListener("click", function () {
      var step = Number(button.dataset.step);
      if (step > maxReached) return;
      goToStep(step);
    });
  });

  NEXT_BUTTON.addEventListener("click", function () {
    if (NEXT_BUTTON.disabled) return;
    if (currentStep === 4) {
      window.location.assign("confirm.html");
      return;
    }
    goToStep(currentStep + 1);
  });

  BACK_BUTTON.addEventListener("click", function () {
    if (currentStep === 1) {
      window.location.assign("index.html");
    } else {
      goToStep(currentStep - 1);
    }
  });

  CAL_PREV.addEventListener("click", function () {
    var moved = T.addMonths(calendar.year, calendar.month, -1);
    calendar.year = moved.year;
    calendar.month = moved.month;
    loadMonth();
  });

  CAL_NEXT.addEventListener("click", function () {
    var moved = T.addMonths(calendar.year, calendar.month, 1);
    calendar.year = moved.year;
    calendar.month = moved.month;
    loadMonth();
  });

  /* ---------- Загрузка ---------- */

  /* Шаг из адреса: ссылки «Изменить» на экране подтверждения ведут
     на booking.html?step=1…4. */
  function requestedStep() {
    var value = new URLSearchParams(window.location.search).get("step");
    var step = parseInt(value, 10);
    return Number.isInteger(step) && step >= 1 && step <= 4 ? step : 0;
  }

  /* Насколько далеко можно вернуться по восстановленному черновику. */
  function restoredMaxReached() {
    var reach = 1;
    if (store.booking.serviceIds.length) reach = 2;
    var master = store.masterById(store.booking.masterId);
    if (reach === 2 && master && store.masterCanServe(master)) reach = 3;
    if (reach === 3 && store.booking.date) reach = 4;
    return reach;
  }

  async function load() {
    renderServices();
    renderMasters();
    updateSummary();
    updateView();

    var results = await Promise.allSettled([
      window.API.getServices(),
      window.API.getMasters(),
      window.API.getStudio(),
    ]);

    var servicesResult = results[0];
    var mastersResult = results[1];
    var studioResult = results[2];

    if (servicesResult.status === "fulfilled") {
      servicesState = "ready";
      store.setServices((servicesResult.value && servicesResult.value.services) || []);
    } else {
      servicesState = "error";
      servicesError = (servicesResult.reason && servicesResult.reason.message) || "";
    }

    if (mastersResult.status === "fulfilled") {
      mastersState = "ready";
      store.setMasters((mastersResult.value && mastersResult.value.masters) || []);
    } else {
      mastersState = "error";
      mastersError = (mastersResult.reason && mastersResult.reason.message) || "";
    }

    if (studioResult.status === "fulfilled") {
      var studio = studioResult.value && studioResult.value.studio;
      studioTz = studio && studio.timezone ? studio.timezone : undefined;
    }
    today = T.todayInZone(studioTz);

    syncMasterWithServices();
    maxReached = Math.max(maxReached, restoredMaxReached());
    renderServices();
    renderMasters();
    updateSummary();

    var requested = requestedStep();
    if (requested) {
      goToStep(Math.min(requested, maxReached));
    } else {
      updateView();
    }
  }

  load();
})();
