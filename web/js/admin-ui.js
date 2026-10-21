/* =========================================================
   web/js/admin-ui.js — общие мелочи для страниц админ-раздела.
   Только вспомогательные функции: создание элементов, сообщения,
   работа с графиком в JSON. Запросов здесь нет — они в js/api.js.
   ========================================================= */

"use strict";

(function () {
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  /* Сообщение под формой: kind = "error" | "ok" | "info". */
  function setMessage(node, text, kind) {
    if (!node) return;
    node.textContent = text || "";
    node.className = "admin-message" + (text ? " is-" + (kind || "info") : "");
    node.hidden = !text;
  }

  function field(labelText, inputNode, hint) {
    const label = el("label", "field");
    label.appendChild(el("span", "field-label", labelText));
    label.appendChild(inputNode);
    if (hint) {
      label.appendChild(hint.nodeType ? hint : el("span", "admin-hint", hint));
    }
    return label;
  }

  function input(attrs) {
    const node = document.createElement("input");
    node.className = "field-input";
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "type") node.type = attrs[key];
      else if (key === "value") node.value = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function textarea(attrs) {
    const node = document.createElement("textarea");
    node.className = "field-input field-textarea";
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === "value") node.value = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    return node;
  }

  function checkbox(labelText, checked) {
    const wrap = el("label", "admin-check");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !!checked;
    wrap.appendChild(box);
    wrap.appendChild(el("span", "admin-check-text", labelText));
    wrap.input = box;
    return wrap;
  }

  /* ---------- График мастера: JSON в поле и обратно ---------- */

  function formatSchedule(items) {
    return JSON.stringify(items || [], null, 2);
  }

  function parseSchedule(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error("График должен быть корректным JSON");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("График должен быть массивом смен, например [{ \"weekday\": 1, \"startTime\": \"10:00\", \"endTime\": \"19:00\" }]");
    }
    parsed.forEach(function (item, index) {
      if (!item || typeof item !== "object") {
        throw new Error("Смена №" + (index + 1) + " должна быть объектом");
      }
      const weekday = Number(item.weekday);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
        throw new Error("Смена №" + (index + 1) + ": день недели должен быть от 1 (Пн) до 7 (Вс)");
      }
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timeRe.test(String(item.startTime || "")) || !timeRe.test(String(item.endTime || ""))) {
        throw new Error("Смена №" + (index + 1) + ": время должно быть в формате HH:MM");
      }
      if (String(item.startTime) >= String(item.endTime)) {
        throw new Error("Смена №" + (index + 1) + ": начало должно быть раньше конца");
      }
    });
    return parsed.map(function (item) {
      return {
        weekday: Number(item.weekday),
        startTime: String(item.startTime),
        endTime: String(item.endTime),
        validFrom: item.validFrom ? String(item.validFrom) : null,
        validTo: item.validTo ? String(item.validTo) : null,
      };
    });
  }

  const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  /* ---------- Подтверждение действия ----------
     Один диалог на страницу: его переиспользуют обе страницы
     админ-раздела (удаление услуги, мастера). */

  function confirmAction(options) {
    const opts = options || {};
    return new Promise(function (resolve) {
      let dialog = document.querySelector("[data-admin-dialog]");

      if (!dialog) {
        dialog = document.createElement("dialog");
        dialog.className = "admin-dialog";
        dialog.setAttribute("data-admin-dialog", "");

        const inner = el("div", "admin-dialog-inner");
        const title = el("h2", "admin-dialog-title");
        const text = el("p", "admin-dialog-text");
        const actions = el("div", "admin-dialog-actions");
        const cancel = el("button", "btn btn-ghost", "Отмена");
        const ok = el("button", "btn btn-danger", "Удалить");
        cancel.type = "button";
        ok.type = "button";

        actions.appendChild(cancel);
        actions.appendChild(ok);
        inner.appendChild(title);
        inner.appendChild(text);
        inner.appendChild(actions);
        dialog.appendChild(inner);
        document.body.appendChild(dialog);

        cancel.addEventListener("click", function () {
          dialog.close("cancel");
        });
        ok.addEventListener("click", function () {
          dialog.close("ok");
        });
        dialog.addEventListener("close", function () {
          resolve(dialog.returnValue === "ok");
        });
      }

      dialog.querySelector(".admin-dialog-title").textContent = opts.title || "Подтвердите действие";
      dialog.querySelector(".admin-dialog-text").textContent = opts.text || "";
      const okButton = dialog.querySelector(".admin-dialog-actions .btn-danger");
      okButton.textContent = opts.okLabel || "Удалить";

      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        resolve(window.confirm(opts.text || ""));
      }
    });
  }

  window.AdminUI = {
    el: el,
    initials: initials,
    setMessage: setMessage,
    field: field,
    input: input,
    textarea: textarea,
    checkbox: checkbox,
    formatSchedule: formatSchedule,
    parseSchedule: parseSchedule,
    confirmAction: confirmAction,
    WEEKDAYS: WEEKDAYS,
  };
})();
