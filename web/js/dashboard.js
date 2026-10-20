/* =========================================================
   web/js/dashboard.js — личный кабинет: активные записи
   и история. Данные приходят из GET /api/bookings/my.
   ========================================================= */

"use strict";

(function () {
  var C = window.Cabinet;
  var LIST = document.getElementById("bookings-panel");
  var LOADING = document.getElementById("cabinet-loading");
  var MESSAGE = document.getElementById("cabinet-message");
  var NOTE = document.getElementById("cabinet-note");
  var TABS = Array.prototype.slice.call(document.querySelectorAll(".cabinet-tab"));
  var ACTIVE_COUNT = document.getElementById("active-count");
  var HISTORY_COUNT = document.getElementById("history-count");

  var state = {
    bookings: [],
    tab: new URLSearchParams(window.location.search).get("tab") === "history"
      ? "history"
      : "active",
  };

  function setTab(tab) {
    state.tab = tab === "history" ? "history" : "active";
    var url = state.tab === "history" ? "?tab=history" : window.location.pathname;
    if (state.tab === "history") {
      window.history.replaceState(null, "", url);
    } else {
      window.history.replaceState(null, "", window.location.pathname);
    }
    render();
  }

  function splitBookings() {
    var active = [];
    var history = [];
    state.bookings.forEach(function (booking) {
      if (C.isActiveVisit(booking)) {
        active.push(booking);
      } else {
        history.push(booking);
      }
    });
    active.sort(function (a, b) {
      return Date.parse(a.startsAt) - Date.parse(b.startsAt);
    });
    history.sort(function (a, b) {
      return Date.parse(b.startsAt) - Date.parse(a.startsAt);
    });
    return { active: active, history: history };
  }

  function statusBadge(status) {
    var meta = C.statusMeta(status);
    return C.el("span", "status-badge " + meta.className, meta.label);
  }

  function metaItem(value, strong) {
    var item = C.el("span", "booking-meta-item");
    if (strong) {
      item.appendChild(C.el("strong", null, strong));
    }
    if (value) item.appendChild(document.createTextNode(value));
    return item;
  }

  function bookingCard(booking, nearest) {
    var card = C.el("a", "booking-tile");
    card.href = "booking-details.html?id=" + encodeURIComponent(booking.id);
    if (nearest) card.classList.add("is-nearest");
    if (!C.isActiveVisit(booking)) card.classList.add("is-history");

    var date = C.el("span", "booking-date");
    date.appendChild(C.el("span", "booking-date-day", C.dayNumber(booking)));
    date.appendChild(C.el("span", "booking-date-month", C.monthName(booking)));

    var main = C.el("span", "booking-main");
    if (nearest) {
      main.appendChild(C.el("span", "nearest-flag", "Ближайший визит"));
    }
    main.appendChild(C.el(
      "span",
      "booking-service",
      (booking.service && booking.service.name) || "Услуга"
    ));
    main.appendChild(C.el(
      "span",
      "booking-master",
      "Мастер: " + ((booking.master && booking.master.fullName) || "—")
    ));

    var meta = C.el("span", "booking-meta");
    meta.appendChild(metaItem(C.fullDate(booking)));
    meta.appendChild(metaItem(C.timeRange(booking), "Время: "));
    meta.appendChild(metaItem(C.duration(booking), "Длительность: "));
    main.appendChild(meta);

    var side = C.el("span", "booking-side");
    side.appendChild(statusBadge(booking.status));
    side.appendChild(C.el("span", "booking-price", C.price(booking)));
    side.appendChild(C.el("span", "booking-open", "Детали →"));

    card.appendChild(date);
    card.appendChild(main);
    card.appendChild(side);
    return card;
  }

  function emptyState(hasAnyBookings) {
    var box = C.el("div", "cabinet-empty");
    box.appendChild(C.el("span", "empty-mark"));
    var title;
    var text;

    if (!hasAnyBookings) {
      title = "Записей пока нет";
      text = "Выберите услугу и удобное время — запись займёт пару минут.";
    } else if (state.tab === "active") {
      title = "Активных визитов нет";
      text = "Все записи уже завершены. Самое время выбрать новое время для визита.";
    } else {
      title = "История пока пуста";
      text = "Здесь появятся прошедшие и отменённые записи.";
    }

    box.appendChild(C.el("h2", "empty-title", title));
    box.appendChild(C.el("p", "empty-text", text));

    var needsAction = !hasAnyBookings || state.tab === "active";
    if (needsAction) {
      var link = C.el("a", "btn btn-primary", "Записаться");
      link.href = "booking.html";
      box.appendChild(link);
    }
    return box;
  }

  function render() {
    var groups = splitBookings();
    var counts = { active: groups.active.length, history: groups.history.length };
    ACTIVE_COUNT.textContent = counts.active;
    HISTORY_COUNT.textContent = counts.history;

    TABS.forEach(function (tab) {
      var active = tab.dataset.tab === state.tab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.tabIndex = active ? 0 : -1;
    });
    LIST.setAttribute("aria-labelledby", state.tab === "history" ? "tab-history" : "tab-active");

    if (state.tab === "active") {
      NOTE.textContent = counts.active
        ? "Ближайший визит выделен цветом."
        : "";
    } else {
      NOTE.textContent = counts.history
        ? "Прошедшие и отменённые визиты."
        : "";
    }

    LIST.innerHTML = "";
    var items = state.tab === "active" ? groups.active : groups.history;
    if (!items.length) {
      LIST.appendChild(emptyState(state.bookings.length > 0));
      return;
    }

    items.forEach(function (booking, index) {
      LIST.appendChild(bookingCard(
        booking,
        state.tab === "active" && index === 0
      ));
    });
  }

  function showError(message) {
    MESSAGE.hidden = false;
    MESSAGE.className = "cabinet-message is-error";
    MESSAGE.textContent = message || "Не удалось загрузить записи.";
    var retry = C.el("button", "btn btn-ghost cabinet-retry", "Повторить");
    retry.type = "button";
    retry.addEventListener("click", load);
    MESSAGE.appendChild(retry);
  }

  function hideError() {
    MESSAGE.hidden = true;
    MESSAGE.className = "cabinet-message";
    MESSAGE.textContent = "";
  }

  async function load() {
    hideError();
    LOADING.hidden = false;
    LIST.hidden = true;

    try {
      await window.API.getMe();
    } catch (error) {
      if (error.status === 401) {
        C.redirectToAuth();
        return;
      }
      LOADING.hidden = true;
      showError(error.message);
      return;
    }

    try {
      var data = await window.API.getMyBookings();
      state.bookings = (data && data.bookings) || [];
      LOADING.hidden = true;
      LIST.hidden = false;
      render();
    } catch (error) {
      LOADING.hidden = true;
      if (error.status === 401) {
        C.redirectToAuth();
        return;
      }
      showError(error.message);
    }
  }

  TABS.forEach(function (tab) {
    tab.addEventListener("click", function () {
      setTab(tab.dataset.tab);
    });
  });

  load();
})();
