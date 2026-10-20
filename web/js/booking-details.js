/* =========================================================
   web/js/booking-details.js — экран деталей записи:
   данные GET /api/bookings/:id, отмена POST /api/bookings/:id/cancel.
   ========================================================= */

"use strict";

(function () {
  var C = window.Cabinet;
  var ID = parseInt(new URLSearchParams(window.location.search).get("id"), 10);

  var MESSAGE = document.getElementById("details-message");
  var LOADING = document.getElementById("details-loading");
  var CONTENT = document.getElementById("details-content");
  var NUMBER = document.getElementById("detail-number");
  var SERVICE = document.getElementById("detail-service");
  var MASTER = document.getElementById("detail-master");
  var STATUS = document.getElementById("detail-status");
  var DATE = document.getElementById("detail-date");
  var TIME = document.getElementById("detail-time");
  var DURATION = document.getElementById("detail-duration");
  var PRICE = document.getElementById("detail-price");
  var CLIENT = document.getElementById("detail-client");
  var PHONE = document.getElementById("detail-phone");
  var COMMENT_ROW = document.getElementById("detail-comment-row");
  var COMMENT = document.getElementById("detail-comment");
  var LATE = document.getElementById("detail-late-warning");
  var INACTIVE = document.getElementById("detail-inactive");
  var ACTIONS = document.getElementById("detail-actions");
  var RESCHEDULE = document.getElementById("detail-reschedule");
  var CANCEL_BUTTON = document.getElementById("detail-cancel");

  var DIALOG = document.getElementById("cancel-dialog");
  var DIALOG_CLOSE = document.getElementById("cancel-close");
  var DIALOG_DISMISS = document.getElementById("cancel-dismiss");
  var DIALOG_CONFIRM = document.getElementById("cancel-confirm");
  var DIALOG_WARNING = document.getElementById("dialog-warning");
  var DIALOG_SUMMARY = document.getElementById("dialog-summary");
  var DIALOG_ERROR = document.getElementById("dialog-error");

  var booking = null;

  function showMessage(text, kind) {
    MESSAGE.hidden = !text;
    MESSAGE.className = "details-message" + (kind ? " is-" + kind : "");
    MESSAGE.textContent = text || "";
  }

  function showPageError(text) {
    LOADING.hidden = true;
    CONTENT.hidden = true;
    showMessage(text || "Не удалось загрузить запись.", "error");
  }

  function inactiveText(value) {
    if (value === "cancelled") return "Запись отменена.";
    if (value === "completed") return "Визит завершён.";
    if (value === "no_show") return "Визит отмечен как несостоявшийся.";
    if (C.isActiveStatus(value)) return "Визит уже начался — изменения недоступны.";
    return "Изменения для этой записи недоступны.";
  }

  function render() {
    var meta = C.statusMeta(booking.status);

    NUMBER.textContent = "Запись № " + booking.id;
    SERVICE.textContent = (booking.service && booking.service.name) || "Услуга";
    MASTER.textContent = "Мастер: " + ((booking.master && booking.master.fullName) || "—");
    STATUS.textContent = meta.label;
    STATUS.className = "status-badge " + meta.className;
    DATE.textContent = C.fullDate(booking);
    TIME.textContent = C.timeRange(booking);
    DURATION.textContent = C.duration(booking);
    PRICE.textContent = C.price(booking);
    CLIENT.textContent = (booking.client && booking.client.fullName) || "—";
    PHONE.textContent = (booking.client && booking.client.phone) || "—";

    var comment = String(booking.comment || "").trim();
    COMMENT_ROW.hidden = !comment;
    COMMENT.textContent = comment;

    var manageable = C.isUpcoming(booking);
    ACTIONS.hidden = !manageable;
    INACTIVE.hidden = manageable;
    INACTIVE.textContent = manageable ? "" : inactiveText(booking.status);
    LATE.hidden = !(manageable && C.needsLateWarning(booking));

    RESCHEDULE.href = "reschedule.html?id=" + encodeURIComponent(booking.id);
    RESCHEDULE.setAttribute("aria-label", "Перенести запись на другое время");
    CANCEL_BUTTON.disabled = false;

    LOADING.hidden = true;
    CONTENT.hidden = false;
  }

  function fillDialogSummary() {
    DIALOG_SUMMARY.innerHTML = "";
    DIALOG_SUMMARY.appendChild(C.el(
      "strong",
      null,
      (booking.service && booking.service.name) || "Услуга"
    ));
    DIALOG_SUMMARY.appendChild(C.el(
      "span",
      null,
      C.fullDate(booking) + " · " + C.timeRange(booking)
    ));
  }

  function openDialog() {
    if (!booking || !C.isUpcoming(booking)) return;
    DIALOG_ERROR.hidden = true;
    DIALOG_ERROR.textContent = "";
    DIALOG_WARNING.hidden = !C.needsLateWarning(booking);
    fillDialogSummary();
    if (typeof DIALOG.showModal === "function") {
      DIALOG.showModal();
    } else {
      DIALOG.setAttribute("open", "");
    }
    DIALOG_CONFIRM.focus();
  }

  function closeDialog() {
    if (typeof DIALOG.close === "function") {
      DIALOG.close();
    } else {
      DIALOG.removeAttribute("open");
    }
  }

  async function cancelBooking() {
    if (!booking) return;
    DIALOG_CONFIRM.disabled = true;
    DIALOG_CONFIRM.textContent = "Отменяем…";
    DIALOG_ERROR.hidden = true;

    try {
      var data = await window.API.cancelBooking(booking.id);
      if (data && data.booking) {
        booking = data.booking;
      } else {
        booking = Object.assign({}, booking, { status: "cancelled" });
      }
      closeDialog();
      render();
      showMessage("Запись отменена.", "success");
    } catch (error) {
      DIALOG_ERROR.textContent = error.message || "Не удалось отменить запись.";
      DIALOG_ERROR.hidden = false;
    } finally {
      DIALOG_CONFIRM.disabled = false;
      DIALOG_CONFIRM.textContent = "Отменить запись";
    }
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

    try {
      var data = await window.API.getBooking(ID);
      booking = data && data.booking;
      if (!booking) {
        showPageError("Запись не найдена.");
        return;
      }
      render();

      var params = new URLSearchParams(window.location.search);
      if (params.get("moved") === "1") {
        showMessage("Запись перенесена. Новое время — ниже.", "success");
        params.delete("moved");
        var query = params.toString();
        window.history.replaceState(
          null,
          "",
          window.location.pathname + (query ? "?" + query : "")
        );
      }
    } catch (error) {
      if (error.status === 401) {
        C.redirectToAuth();
        return;
      }
      showPageError(error.message);
    }
  }

  CANCEL_BUTTON.addEventListener("click", openDialog);
  DIALOG_CLOSE.addEventListener("click", closeDialog);
  DIALOG_DISMISS.addEventListener("click", closeDialog);
  DIALOG_CONFIRM.addEventListener("click", cancelBooking);
  DIALOG.addEventListener("click", function (event) {
    if (event.target === DIALOG) closeDialog();
  });

  load();
})();
