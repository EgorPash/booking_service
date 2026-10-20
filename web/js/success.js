/* =========================================================
   web/js/success.js — экран успеха (Booking 05).
   Снимок созданной записи приходит из confirm.js через
   sessionStorage; детали уточняем у API:
     GET /api/bookings/:id → мастер, услуги, дата/время, статус.
   Ошибки API показываем текстом ответа.
   ========================================================= */

"use strict";

(function () {
  var store = window.BookingStore;
  var T = window.BookingTime;
  var F = window.Format;

  var RESULT_KEY = "lumi.booking.result";

  var STATUS_LABELS = {
    pending: "Ожидает подтверждения",
    confirmed: "Подтверждена",
    cancelled: "Отменена",
    completed: "Завершена",
    no_show: "Не пришёл",
  };

  var STATUS = document.getElementById("success-status");
  var NUMBER = document.getElementById("success-number");
  var MASTER = document.getElementById("success-master");
  var DATE = document.getElementById("success-date");
  var TIME = document.getElementById("success-time");
  var SERVICES = document.getElementById("success-services");
  var DURATION = document.getElementById("success-duration");
  var TOTAL = document.getElementById("success-total");
  var CLIENT_ROW = document.getElementById("success-client-row");
  var CLIENT = document.getElementById("success-client");
  var NOTE = document.getElementById("success-note");
  var HOME = document.getElementById("success-home");
  var AGAIN = document.getElementById("success-again");

  function setText(node, text) {
    if (node) node.textContent = text;
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  function readResult() {
    try {
      return JSON.parse(sessionStorage.getItem(RESULT_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function clearResult() {
    try {
      sessionStorage.removeItem(RESULT_KEY);
    } catch (error) {
      // см. readResult()
    }
  }

  function renderServices(list) {
    SERVICES.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("li");
      empty.className = "success-service-name";
      empty.textContent = "—";
      SERVICES.appendChild(empty);
      return;
    }

    list.forEach(function (service) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      name.className = "success-service-name";
      name.textContent = service.name;
      var price = document.createElement("span");
      price.className = "success-service-price";
      price.textContent = F.price(service.priceMinor, service.currency);
      item.appendChild(name);
      item.appendChild(price);
      SERVICES.appendChild(item);
    });
  }

  function setStatus(status) {
    if (!status) {
      show(STATUS, false);
      return;
    }
    STATUS.textContent = STATUS_LABELS[status] || status;
    STATUS.className = "success-status is-" + status;
    STATUS.hidden = false;
  }

  function showNote(text) {
    if (!NOTE) return;
    NOTE.textContent = text;
    NOTE.hidden = false;
  }

  function endSuffix(snapshot) {
    if (!snapshot.endsAt || !snapshot.timezone || !snapshot.time) return "";
    var end = T.timeInZone(snapshot.endsAt, snapshot.timezone);
    return end && end !== snapshot.time ? " – " + end : "";
  }

  function renderSnapshot(snapshot) {
    setText(MASTER, snapshot.masterName || "—");
    setText(DATE, snapshot.date ? T.humanDate(snapshot.date) : "—");
    setText(TIME, (snapshot.time || "—") + endSuffix(snapshot));
    renderServices(snapshot.services || []);
    setText(DURATION, F.duration(snapshot.durationMin));
    setText(TOTAL, F.price(snapshot.priceMinor, snapshot.currency));

    var ids = snapshot.bookingIds || [];
    setText(NUMBER, ids.length ? "№ " + ids.join(", ") : "");
    show(STATUS, false);
    show(CLIENT_ROW, false);
  }

  function renderDetails(rows) {
    rows.sort(function (a, b) {
      if (a.startsAt === b.startsAt) return 0;
      return a.startsAt < b.startsAt ? -1 : 1;
    });

    var first = rows[0];
    var last = rows[rows.length - 1];

    setText(MASTER, (first.master && first.master.fullName) || "—");

    if (first.startsAtLocal) {
      setText(DATE, T.humanDate(first.startsAtLocal.date));
    }

    var start = first.startsAtLocal ? first.startsAtLocal.time : "";
    var end = last.endsAtLocal ? last.endsAtLocal.time : "";
    if (start) setText(TIME, end && end !== start ? start + " – " + end : start);

    var services = rows
      .map(function (row) {
        return {
          name: row.service ? row.service.name : "—",
          priceMinor: row.priceMinor,
          currency: row.currency,
        };
      })
      .filter(Boolean);
    renderServices(services);

    var durationMin = rows.reduce(function (sum, row) {
      return sum + (Number(row.durationMin) || 0);
    }, 0);
    var priceMinor = rows.reduce(function (sum, row) {
      return sum + (Number(row.priceMinor) || 0);
    }, 0);

    setText(DURATION, F.duration(durationMin));
    setText(TOTAL, F.price(priceMinor, first.currency));

    setText(
      NUMBER,
      rows.length
        ? "№ " +
            rows
              .map(function (row) {
                return row.id;
              })
              .join(", ")
        : ""
    );

    setStatus(first.status);

    if (first.client && first.client.fullName) {
      var clientText = first.client.fullName;
      if (first.client.phone) clientText += " · " + first.client.phone;
      setText(CLIENT, clientText);
      show(CLIENT_ROW, true);
    }
  }

  function loadDetails(snapshot) {
    var ids = (snapshot.bookingIds || []).filter(Boolean);
    if (!ids.length) return;

    Promise.allSettled(
      ids.map(function (id) {
        return window.API.getBooking(id);
      })
    ).then(function (results) {
      var rows = [];
      var error = null;

      results.forEach(function (result) {
        if (result.status === "fulfilled" && result.value && result.value.booking) {
          rows.push(result.value.booking);
        } else if (result.status === "rejected" && !error) {
          error = result.reason;
        }
      });

      if (rows.length === ids.length) {
        renderDetails(rows);
      } else if (error) {
        showNote(error.message);
      }
    });
  }

  function cleanup() {
    try {
      store.reset();
    } catch (error) {
      // состояние могло не загрузиться — результат всё равно убираем
    }
    clearResult();
  }

  var snapshot = readResult();
  if (!snapshot || !Array.isArray(snapshot.services)) {
    window.location.replace("booking.html");
    return;
  }

  renderSnapshot(snapshot);
  loadDetails(snapshot);

  HOME.addEventListener("click", cleanup);

  AGAIN.addEventListener("click", function () {
    cleanup();
    window.location.assign("booking.html");
  });
})();
