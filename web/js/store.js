/* =========================================================
   web/js/store.js — состояние записи (выбор клиента).
   Повторяет подход чернового фронта (test-frontend/app.js):
   каталог и выбор лежат в обычном объекте state.
   Черновик записи сохраняется в sessionStorage, чтобы выбор
   переживал переходы между страницами (запись → подтверждение →
   успех) и возврат после входа. Запросов к серверу здесь нет —
   только данные, полученные через window.API, и выбор клиента.
   ========================================================= */

"use strict";

(function () {
  var DRAFT_KEY = "lumi.booking.draft";

  var state = {
    services: [],
    masters: [],
    booking: {
      serviceIds: [],
      masterId: "",
      date: "",
      slot: null,
      holdId: null,
      holdStartsAt: null,
      holdExpiresAt: null,
    },
  };

  /* ---------- Сохранение черновика между страницами ---------- */

  function persist() {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(state.booking));
    } catch (error) {
      // Приватный режим или переполнение — просто работаем без сохранения.
    }
  }

  function restore() {
    var raw;
    try {
      raw = sessionStorage.getItem(DRAFT_KEY);
    } catch (error) {
      return;
    }
    if (!raw) return;

    var saved;
    try {
      saved = JSON.parse(raw);
    } catch (error) {
      return;
    }
    if (!saved || typeof saved !== "object") return;

    var booking = state.booking;

    if (Array.isArray(saved.serviceIds)) {
      booking.serviceIds = saved.serviceIds
        .map(function (id) {
          return Number(id);
        })
        .filter(function (id, index, list) {
          return Number.isInteger(id) && id > 0 && list.indexOf(id) === index;
        });
    }

    if (typeof saved.masterId === "number" || typeof saved.masterId === "string") {
      booking.masterId = saved.masterId;
    }

    if (typeof saved.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(saved.date)) {
      booking.date = saved.date;
    }

    if (
      saved.slot &&
      typeof saved.slot === "object" &&
      typeof saved.slot.startsAt === "string"
    ) {
      booking.slot = {
        startsAt: saved.slot.startsAt,
        endsAt: typeof saved.slot.endsAt === "string" ? saved.slot.endsAt : "",
        time: typeof saved.slot.time === "string" ? saved.slot.time : "",
      };
    }

    if (typeof saved.holdId === "string" && saved.holdId) booking.holdId = saved.holdId;
    if (typeof saved.holdStartsAt === "string") booking.holdStartsAt = saved.holdStartsAt;
    if (typeof saved.holdExpiresAt === "string") {
      booking.holdExpiresAt = saved.holdExpiresAt;
    }

    // Битые комбинации: без услуг/мастера/даты слот не имеет смысла.
    if (!booking.serviceIds.length) booking.masterId = "";
    if (!booking.masterId) booking.date = "";
    if (!booking.date) booking.slot = null;
    if (!booking.slot) resetHoldFields();
  }

  /* ---------- Каталог ---------- */

  function serviceById(id) {
    return (
      state.services.find(function (s) {
        return s.id === id;
      }) || null
    );
  }

  function masterById(id) {
    return (
      state.masters.find(function (m) {
        return m.id === id;
      }) || null
    );
  }

  function setServices(list) {
    state.services = Array.isArray(list) ? list : [];
    // Убираем из выбора услуги, которых больше нет в каталоге.
    state.booking.serviceIds = state.booking.serviceIds.filter(function (id) {
      return state.services.some(function (s) {
        return s.id === id;
      });
    });
    persist();
  }

  function setMasters(list) {
    state.masters = Array.isArray(list) ? list : [];
  }

  function hasService(id) {
    return state.booking.serviceIds.indexOf(id) !== -1;
  }

  /* ---------- Выбор ---------- */

  function resetHoldFields() {
    state.booking.holdId = null;
    state.booking.holdStartsAt = null;
    state.booking.holdExpiresAt = null;
  }

  /* Переключение услуги в мультивыборе. Меняем только выбор услуг:
     время/удержание сбрасываются, мастер проверяется отдельно. */
  function toggleService(id) {
    if (hasService(id)) {
      state.booking.serviceIds = state.booking.serviceIds.filter(function (x) {
        return x !== id;
      });
    } else {
      state.booking.serviceIds = state.booking.serviceIds.concat([id]);
    }
    state.booking.slot = null;
    resetHoldFields();
    persist();
    return state.booking.serviceIds;
  }

  function setMasterId(id) {
    state.booking.masterId = id === null || id === undefined ? "" : id;
    state.booking.slot = null;
    resetHoldFields();
    persist();
  }

  function setDate(date) {
    state.booking.date = date || "";
    state.booking.slot = null;
    resetHoldFields();
    persist();
  }

  function setSlot(slot) {
    state.booking.slot = slot || null;
    resetHoldFields();
    persist();
  }

  /* ---------- Удержание слота ---------- */

  function setHold(holdId, startsAt, expiresAt) {
    state.booking.holdId = holdId || null;
    state.booking.holdStartsAt = startsAt || null;
    state.booking.holdExpiresAt = expiresAt || null;
    persist();
  }

  function clearHold() {
    resetHoldFields();
    persist();
  }

  /* ---------- Производные значения ---------- */

  function getSelectedServices() {
    return state.booking.serviceIds.map(serviceById).filter(Boolean);
  }

  /* Сумма по выбранным услугам: данные берём из ответа сервера
     (durationMin/priceMinor), складываем уже в браузере. */
  function totals() {
    return getSelectedServices().reduce(
      function (acc, service) {
        acc.durationMin += Number(service.durationMin) || 0;
        acc.priceMinor += Number(service.priceMinor) || 0;
        acc.currency = service.currency || acc.currency;
        return acc;
      },
      { durationMin: 0, priceMinor: 0, currency: "RUB" }
    );
  }

  /* Мастер подходит, если оказывает все выбранные услуги. */
  function masterCanServe(master, serviceIds) {
    if (!master) return false;
    var ids = serviceIds || state.booking.serviceIds;
    if (!ids.length) return false;
    var set = master.serviceIds || [];
    return ids.every(function (id) {
      return set.indexOf(id) !== -1;
    });
  }

  function reset() {
    state.booking.serviceIds = [];
    state.booking.masterId = "";
    state.booking.date = "";
    state.booking.slot = null;
    resetHoldFields();
    try {
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      // см. persist()
    }
  }

  restore();

  window.BookingStore = {
    state: state,
    booking: state.booking,
    setServices: setServices,
    setMasters: setMasters,
    serviceById: serviceById,
    masterById: masterById,
    hasService: hasService,
    toggleService: toggleService,
    setMasterId: setMasterId,
    setDate: setDate,
    setSlot: setSlot,
    setHold: setHold,
    clearHold: clearHold,
    getSelectedServices: getSelectedServices,
    totals: totals,
    masterCanServe: masterCanServe,
    reset: reset,
  };
})();
