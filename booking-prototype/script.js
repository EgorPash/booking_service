(function () {
  "use strict";

  var screens = {
    landing: document.getElementById("screen-landing"),
    booking: document.getElementById("screen-booking"),
    confirmation: document.getElementById("screen-confirmation")
  };

  /* Состояние текущей записи */
  var bookingState = {
    service: "Женская стрижка",
    master: null,
    date: null,
    time: null
  };

  var confirmBtn = document.getElementById("confirm-booking");
  var formHint = document.getElementById("form-hint");

  /* ---------- Переключение экранов ---------- */

  function showScreen(name) {
    if (!screens[name]) return;

    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("active", key === name);
    });

    document.querySelectorAll(".nav-link").forEach(function (link) {
      link.classList.toggle("active", link.dataset.screen === name);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.addEventListener("click", function (event) {
    var trigger = event.target.closest("[data-screen]");
    if (trigger) {
      showScreen(trigger.dataset.screen);
      return;
    }

    var scrollTrigger = event.target.closest("[data-scroll]");
    if (scrollTrigger) {
      var target = document.getElementById(scrollTrigger.dataset.scroll);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  });

  /* ---------- Выбор мастера, даты и времени ---------- */

  function setupPicker(pickerId, stateKey) {
    var picker = document.getElementById(pickerId);

    picker.addEventListener("click", function (event) {
      var option = event.target.closest(".option-btn");
      if (!option) return;

      picker.querySelectorAll(".option-btn").forEach(function (btn) {
        var isSelected = btn === option;
        btn.classList.toggle("selected", isSelected);
        btn.setAttribute("aria-selected", isSelected ? "true" : "false");
      });

      bookingState[stateKey] = option.dataset.value;
      updateConfirmState();
    });
  }

  setupPicker("master-picker", "master");
  setupPicker("date-picker", "date");
  setupPicker("time-picker", "time");

  function isReady() {
    return Boolean(bookingState.master && bookingState.date && bookingState.time);
  }

  function updateConfirmState() {
    var ready = isReady();
    confirmBtn.disabled = !ready;
    formHint.classList.toggle("hint-ready", ready);
    formHint.textContent = ready
      ? "Всё выбрано — можно подтвердить запись."
      : "Выберите мастера, дату и время, чтобы подтвердить запись.";
  }

  /* ---------- Подтверждение записи ---------- */

  confirmBtn.addEventListener("click", function () {
    if (!isReady()) return;

    /* Данные сохранены в объекте bookingState */
    console.log("Запись сохранена:", {
      service: bookingState.service,
      master: bookingState.master,
      date: bookingState.date,
      time: bookingState.time
    });

    document.getElementById("sum-service").textContent = bookingState.service;
    document.getElementById("sum-master").textContent = bookingState.master;
    document.getElementById("sum-date").textContent = bookingState.date;
    document.getElementById("sum-time").textContent = bookingState.time;

    showScreen("confirmation");
  });

  /* ---------- Новая запись ---------- */

  function resetPickers() {
    document.querySelectorAll(".option-btn.selected").forEach(function (btn) {
      btn.classList.remove("selected");
      btn.setAttribute("aria-selected", "false");
    });
    bookingState.master = null;
    bookingState.date = null;
    bookingState.time = null;
    updateConfirmState();
  }

  document.getElementById("new-booking").addEventListener("click", function () {
    resetPickers();
    showScreen("booking");
  });

  updateConfirmState();
})();
