/* =========================================================
   web/js/admin-services.js — экран «Услуги» (/admin/services.html).
   Каталог услуг: добавление, правка, включение/выключение и
   умное удаление. Если по услуге есть записи, сервер не удаляет
   её, а отключает — сообщение об этом показываем на странице.

   Правило: сервер — источник истины. Проверки в форме нужны для
   быстрой подсказки, сервер проверяет те же значения сам и
   возвращает понятный текст ошибки.
   ========================================================= */

"use strict";

(function () {
  const ui = window.AdminUI;

  const listNode = document.querySelector("[data-services-list]");
  const pageMessage = document.querySelector("[data-services-message]");
  const createForm = document.querySelector("[data-service-create]");
  const createMessage = document.querySelector("[data-service-create-message]");
  const createPriceHint = document.querySelector("[data-service-create-price-hint]");

  let services = [];

  /* ---------- Форматы ---------- */

  function money(minor, currency) {
    return window.Format ? window.Format.price(minor, currency) : String(minor);
  }

  function duration(min) {
    return window.Format ? window.Format.duration(min) : String(min);
  }

  function records(count) {
    if (!window.Format) return count + " записей";
    return count + " " + window.Format.plural(count, "запись", "записи", "записей");
  }

  function mastersCount(count) {
    if (!window.Format) return count + " мастеров";
    return count + " " + window.Format.plural(count, "мастер", "мастера", "мастеров");
  }

  function setPriceHint(node, value) {
    if (!node) return;
    const minor = Number(value);
    if (!Number.isFinite(minor) || minor <= 0) {
      node.textContent = "—";
      return;
    }
    node.textContent = "= " + money(minor);
  }

  function showPage(text, kind) {
    ui.setMessage(pageMessage, text, kind);
  }

  /* ---------- Список ---------- */

  function serviceItem(service) {
    const item = ui.el("article", "admin-item");
    if (!service.isActive) item.classList.add("is-inactive");

    const head = ui.el("div", "admin-item-head");
    const headText = ui.el("div", "admin-item-head-text");

    const title = ui.el("h3", "admin-item-title");
    title.appendChild(document.createTextNode(service.name));
    title.appendChild(ui.el("span", "admin-item-id", "#" + service.id));
    headText.appendChild(title);

    const meta = ui.el("p", "admin-item-meta");
    meta.textContent = [
      duration(service.durationMin),
      money(service.priceMinor, service.currency),
      records(service.bookingsCount || 0) + " в истории",
      mastersCount(service.mastersCount || 0) + " оказывают",
    ].join(" · ");
    headText.appendChild(meta);
    head.appendChild(headText);

    head.appendChild(
      ui.el(
        "span",
        "status-badge admin-badge " + (service.isActive ? "is-active" : "is-inactive"),
        service.isActive ? "Активна" : "Отключена"
      )
    );
    item.appendChild(head);

    if (service.description) {
      item.appendChild(ui.el("p", "admin-item-text", service.description));
    }

    const form = ui.el("form", "admin-form admin-form-compact");
    const grid = ui.el("div", "admin-grid");

    const nameInput = ui.input({
      type: "text",
      name: "name",
      maxlength: "200",
      value: service.name,
      required: "required",
    });
    grid.appendChild(ui.field("Название", nameInput));

    const durationInput = ui.input({
      type: "number",
      name: "durationMin",
      min: "1",
      max: "1440",
      step: "1",
      value: String(service.durationMin),
      required: "required",
    });
    grid.appendChild(ui.field("Длительность, минут", durationInput));

    const priceInput = ui.input({
      type: "number",
      name: "priceMinor",
      min: "1",
      step: "1",
      value: String(service.priceMinor),
      required: "required",
    });
    const priceHint = ui.el("span", "admin-hint");
    setPriceHint(priceHint, service.priceMinor);
    priceInput.addEventListener("input", function () {
      setPriceHint(priceHint, priceInput.value);
    });
    grid.appendChild(ui.field("Цена, коп.", priceInput, priceHint));

    grid.appendChild(ui.checkbox("Активна", service.isActive));
    form.appendChild(grid);

    const actions = ui.el("div", "admin-actions");
    const save = ui.el("button", "btn btn-primary", "Сохранить");
    save.type = "submit";
    const toggle = ui.el("button", "btn btn-ghost", service.isActive ? "Выключить" : "Включить");
    toggle.type = "button";
    const remove = ui.el("button", "btn btn-danger", "Удалить");
    remove.type = "button";
    actions.appendChild(save);
    actions.appendChild(toggle);
    actions.appendChild(remove);
    form.appendChild(actions);

    const message = ui.el("p", "admin-message");
    message.hidden = true;
    form.appendChild(message);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      saveService(service, form, message);
    });
    toggle.addEventListener("click", function () {
      toggleService(service, toggle, message);
    });
    remove.addEventListener("click", function () {
      deleteService(service, message);
    });

    item.appendChild(form);
    return item;
  }

  function render() {
    listNode.innerHTML = "";
    if (!services.length) {
      listNode.appendChild(
        ui.el("div", "data-empty", "Услуг пока нет. Добавьте первую в форме выше.")
      );
      return;
    }
    services.forEach(function (service) {
      listNode.appendChild(serviceItem(service));
    });
  }

  async function load() {
    const data = await window.API.getAdminServices();
    services = (data && data.services) || [];
    render();
  }

  /* ---------- Действия ---------- */

  function readForm(form) {
    const data = new FormData(form);
    const activeBox = form.querySelector('[name="isActive"]');
    return {
      name: String(data.get("name") || "").trim(),
      durationMin: Number(data.get("durationMin")),
      priceMinor: Number(data.get("priceMinor")),
      isActive: activeBox ? activeBox.checked : true,
    };
  }

  function validateService(body) {
    if (!body.name) return "Название услуги не может быть пустым";
    if (!Number.isInteger(body.durationMin) || body.durationMin < 1) {
      return "Длительность должна быть больше нуля";
    }
    if (!Number.isInteger(body.priceMinor) || body.priceMinor < 1) {
      return "Цена должна быть больше нуля";
    }
    return "";
  }

  async function saveService(service, form, message) {
    ui.setMessage(message, "");
    const body = readForm(form);
    const problem = validateService(body);
    if (problem) {
      ui.setMessage(message, problem, "error");
      return;
    }

    try {
      await window.API.updateService(service.id, body);
      await load();
      showPage("Услуга «" + body.name + "» сохранена.", "ok");
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось сохранить услугу", "error");
    }
  }

  async function toggleService(service, button, message) {
    ui.setMessage(message, "");
    button.disabled = true;
    try {
      await window.API.updateService(service.id, { isActive: !service.isActive });
      await load();
      showPage(
        service.isActive
          ? "Услуга «" + service.name + "» отключена: в форме записи её больше нет."
          : "Услуга «" + service.name + "» включена.",
        "ok"
      );
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось изменить услугу", "error");
      button.disabled = false;
    }
  }

  async function deleteService(service, message) {
    ui.setMessage(message, "");
    const confirmed = await ui.confirmAction({
      title: "Удалить услугу?",
      text:
        "Если по услуге «" + service.name + "» есть записи, сервер не удалит её, а отключит: " +
        "старые записи останутся со своими ценой и длительностью.",
      okLabel: "Удалить",
    });
    if (!confirmed) return;

    try {
      const result = await window.API.deleteService(service.id);
      await load();
      showPage(
        (result && result.message) || "Готово.",
        result && result.deleted ? "ok" : "info"
      );
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось удалить услугу", "error");
    }
  }

  async function createService(event) {
    event.preventDefault();
    ui.setMessage(createMessage, "");

    const data = new FormData(createForm);
    const activeBox = createForm.querySelector('[name="isActive"]');
    const body = {
      name: String(data.get("name") || "").trim(),
      durationMin: Number(data.get("durationMin")),
      priceMinor: Number(data.get("priceMinor")),
      description: String(data.get("description") || "").trim(),
      isActive: activeBox ? activeBox.checked : true,
    };

    const problem = validateService(body);
    if (problem) {
      ui.setMessage(createMessage, problem, "error");
      return;
    }

    try {
      const result = await window.API.createService(body);
      createForm.reset();
      if (createPriceHint) createPriceHint.textContent = "—";
      await load();
      showPage(
        "Услуга «" + ((result && result.service && result.service.name) || body.name) + "» добавлена.",
        "ok"
      );
    } catch (error) {
      ui.setMessage(createMessage, error.message || "Не удалось добавить услугу", "error");
    }
  }

  /* ---------- Запуск ---------- */

  window.AdminShell.ready.then(function (user) {
    if (!user) return;

    createForm.addEventListener("submit", createService);

    const priceInput = createForm.querySelector('[name="priceMinor"]');
    if (priceInput) {
      priceInput.addEventListener("input", function () {
        setPriceHint(createPriceHint, priceInput.value);
      });
    }

    load().catch(function (error) {
      showPage(error.message || "Не удалось загрузить услуги", "error");
    });
  });
})();
