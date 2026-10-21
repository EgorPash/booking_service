/* =========================================================
   web/js/admin-masters.js — экран «Мастера» (/admin/masters.html).
   Профили мастеров: добавление, правка, отметки услуг, график
   работы, включение/выключение и умное удаление.

   Связка «мастер → услуги» — главное на этом экране: отметки
   рядом с услугами показывают, что мастер выполняет, и именно
   по ним мастер доступен в клиентской форме записи.

   Правило: сервер — источник истины, форма только подсказывает.
   ========================================================= */

"use strict";

(function () {
  const ui = window.AdminUI;

  const listNode = document.querySelector("[data-masters-list]");
  const pageMessage = document.querySelector("[data-masters-message]");
  const createForm = document.querySelector("[data-master-create]");
  const createMessage = document.querySelector("[data-master-create-message]");
  const createServicesNode = document.querySelector("[data-master-create-services]");

  let masters = [];
  let services = [];
  let schedules = {};

  /* ---------- Форматы ---------- */

  function money(minor, currency) {
    return window.Format ? window.Format.price(minor, currency) : String(minor);
  }

  function records(count) {
    if (!window.Format) return count + " записей";
    return count + " " + window.Format.plural(count, "запись", "записи", "записей");
  }

  function showPage(text, kind) {
    ui.setMessage(pageMessage, text, kind);
  }

  function serviceById(id) {
    return (
      services.find(function (service) {
        return service.id === id;
      }) || null
    );
  }

  function serviceName(id) {
    const service = serviceById(id);
    return service ? service.name : "#" + id;
  }

  /* ---------- Отметки услуг ---------- */

  function serviceChecks(selectedIds, options) {
    const opts = options || {};
    const wrap = ui.el("div", "admin-check-list");
    if (!services.length) {
      wrap.appendChild(ui.el("span", "admin-hint", "Услуг пока нет — добавьте их в разделе «Услуги»."));
      return wrap;
    }
    services.forEach(function (service) {
      const box = ui.checkbox(
        service.name + " · " + money(service.priceMinor, service.currency),
        selectedIds.indexOf(service.id) !== -1
      );
      box.input.setAttribute("data-service-id", String(service.id));
      if (opts.disabled) box.input.disabled = true;
      wrap.appendChild(box);
    });
    return wrap;
  }

  function selectedIds(root) {
    const ids = [];
    root.querySelectorAll('input[type="checkbox"]').forEach(function (box) {
      if (!box.checked) return;
      const value = Number(box.getAttribute("data-service-id"));
      if (Number.isInteger(value) && value > 0) ids.push(value);
    });
    return ids;
  }

  /* ---------- Список мастеров ---------- */

  function masterItem(master) {
    const item = ui.el("article", "admin-item");
    if (!master.isActive) item.classList.add("is-inactive");

    const head = ui.el("div", "admin-item-head");
    const headText = ui.el("div", "admin-item-head-text");

    const title = ui.el("h3", "admin-item-title");
    title.appendChild(document.createTextNode(master.fullName));
    title.appendChild(ui.el("span", "admin-item-id", "#" + master.id));
    headText.appendChild(title);

    const meta = ui.el("p", "admin-item-meta");
    const metaParts = [];
    if (master.title) metaParts.push(master.title);
    metaParts.push(records(master.bookingsCount || 0) + " в истории");
    meta.textContent = metaParts.join(" · ");
    headText.appendChild(meta);
    head.appendChild(headText);

    head.appendChild(
      ui.el(
        "span",
        "status-badge admin-badge " + (master.isActive ? "is-active" : "is-inactive"),
        master.isActive ? "Активен" : "Отключён"
      )
    );
    item.appendChild(head);

    if (master.bio) {
      item.appendChild(ui.el("p", "admin-item-text", master.bio));
    }

    /* Отметки услуг: что мастер выполняет сейчас. */
    const serviceIds = master.serviceIds || [];
    const marks = ui.el("div", "admin-tags");
    if (serviceIds.length) {
      serviceIds.forEach(function (id) {
        marks.appendChild(ui.el("span", "tag", serviceName(id)));
      });
    } else {
      marks.appendChild(ui.el("span", "admin-hint", "Услуги не назначены — мастер не появится в форме записи."));
    }
    item.appendChild(marks);

    /* Профиль */
    const profileForm = ui.el("form", "admin-form admin-form-compact");
    const profileGrid = ui.el("div", "admin-grid");

    const nameInput = ui.input({
      type: "text",
      name: "fullName",
      maxlength: "120",
      value: master.fullName,
      required: "required",
    });
    profileGrid.appendChild(ui.field("Имя", nameInput));

    const titleInput = ui.input({
      type: "text",
      name: "title",
      maxlength: "200",
      value: master.title || "",
    });
    profileGrid.appendChild(ui.field("Должность", titleInput));

    const bioInput = ui.input({
      type: "text",
      name: "bio",
      maxlength: "2000",
      value: master.bio || "",
    });
    profileGrid.appendChild(ui.field("О мастере", bioInput));

    profileGrid.appendChild(ui.checkbox("Активен", master.isActive));
    profileForm.appendChild(profileGrid);

    const profileActions = ui.el("div", "admin-actions");
    const saveProfile = ui.el("button", "btn btn-primary", "Сохранить профиль");
    saveProfile.type = "submit";
    const toggle = ui.el("button", "btn btn-ghost", master.isActive ? "Выключить" : "Включить");
    toggle.type = "button";
    const remove = ui.el("button", "btn btn-danger", "Удалить");
    remove.type = "button";
    profileActions.appendChild(saveProfile);
    profileActions.appendChild(toggle);
    profileActions.appendChild(remove);
    profileForm.appendChild(profileActions);

    const profileMessage = ui.el("p", "admin-message");
    profileMessage.hidden = true;
    profileForm.appendChild(profileMessage);

    profileForm.addEventListener("submit", function (event) {
      event.preventDefault();
      saveProfile_(master, profileForm, profileMessage);
    });
    toggle.addEventListener("click", function () {
      toggleMaster(master, toggle, profileMessage);
    });
    remove.addEventListener("click", function () {
      deleteMaster(master, profileMessage);
    });

    item.appendChild(profileForm);

    /* Услуги мастера */
    const servicesForm = ui.el("form", "admin-form admin-form-compact");
    const servicesWrap = ui.el("div", "admin-fieldset");
    servicesWrap.appendChild(ui.el("span", "field-label", "Услуги мастера"));
    const checks = serviceChecks(serviceIds);
    servicesWrap.appendChild(checks);
    servicesForm.appendChild(servicesWrap);

    const servicesActions = ui.el("div", "admin-actions");
    const saveServices = ui.el("button", "btn btn-primary", "Сохранить услуги");
    saveServices.type = "submit";
    servicesActions.appendChild(saveServices);
    servicesForm.appendChild(servicesActions);

    const servicesMessage = ui.el("p", "admin-message");
    servicesMessage.hidden = true;
    servicesForm.appendChild(servicesMessage);

    servicesForm.addEventListener("submit", function (event) {
      event.preventDefault();
      saveServices_(master, checks, servicesMessage);
    });

    item.appendChild(servicesForm);

    /* График */
    const scheduleForm = ui.el("form", "admin-form admin-form-compact");
    const scheduleField = ui.el("div", "admin-fieldset");
    scheduleField.appendChild(ui.el("span", "field-label", "График работы (JSON)"));
    const scheduleInput = ui.textarea({
      name: "schedule",
      rows: "6",
      spellcheck: "false",
      placeholder: '[{"weekday":1,"startTime":"10:00","endTime":"19:00"}]',
    });
    scheduleInput.value = ui.formatSchedule(schedules[master.id] || []);
    scheduleField.appendChild(scheduleInput);
    scheduleField.appendChild(
      ui.el(
        "span",
        "admin-hint",
        "weekday: 1 = Пн … 7 = Вс. Пустой массив — мастер не работает."
      )
    );
    scheduleForm.appendChild(scheduleField);

    const scheduleActions = ui.el("div", "admin-actions");
    const saveSchedule = ui.el("button", "btn btn-primary", "Сохранить график");
    saveSchedule.type = "submit";
    scheduleActions.appendChild(saveSchedule);
    scheduleForm.appendChild(scheduleActions);

    const scheduleMessage = ui.el("p", "admin-message");
    scheduleMessage.hidden = true;
    scheduleForm.appendChild(scheduleMessage);

    scheduleForm.addEventListener("submit", function (event) {
      event.preventDefault();
      saveSchedule_(master, scheduleInput, scheduleMessage);
    });

    item.appendChild(scheduleForm);

    return item;
  }

  function render() {
    listNode.innerHTML = "";
    if (!masters.length) {
      listNode.appendChild(
        ui.el("div", "data-empty", "Мастеров пока нет. Добавьте первого в форме выше.")
      );
      return;
    }
    masters.forEach(function (master) {
      listNode.appendChild(masterItem(master));
    });
  }

  async function load() {
    const [mastersData, servicesData] = await Promise.all([
      window.API.getAdminMasters(),
      window.API.getAdminServices(),
    ]);
    masters = (mastersData && mastersData.masters) || [];
    services = (servicesData && servicesData.services) || [];

    schedules = {};
    await Promise.all(
      masters.map(async function (master) {
        try {
          const data = await window.API.getMasterSchedule(master.id);
          schedules[master.id] = (data && data.schedule) || [];
        } catch (error) {
          schedules[master.id] = [];
        }
      })
    );

    renderCreateServices();
    render();
  }

  function renderCreateServices() {
    if (!createServicesNode) return;
    // Сохраняем отметки, выбранные до перезагрузки списка.
    const current = selectedIds(createServicesNode);
    createServicesNode.innerHTML = "";
    createServicesNode.appendChild(serviceChecks(current));
  }

  /* ---------- Действия ---------- */

  async function saveProfile_(master, form, message) {
    ui.setMessage(message, "");
    const data = new FormData(form);
    const activeBox = form.querySelector('[name="isActive"]');
    const body = {
      fullName: String(data.get("fullName") || "").trim(),
      title: String(data.get("title") || "").trim(),
      bio: String(data.get("bio") || "").trim(),
      isActive: activeBox ? activeBox.checked : true,
    };

    if (!body.fullName) {
      ui.setMessage(message, "Имя мастера не может быть пустым", "error");
      return;
    }

    try {
      await window.API.updateMaster(master.id, body);
      await load();
      showPage("Профиль мастера «" + body.fullName + "» сохранён.", "ok");
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось сохранить профиль", "error");
    }
  }

  async function saveServices_(master, checks, message) {
    ui.setMessage(message, "");
    const ids = selectedIds(checks);
    try {
      await window.API.setMasterServices(master.id, ids);
      await load();
      showPage(
        ids.length
          ? "Услуги мастера «" + master.fullName + "» сохранены: " + ids.map(serviceName).join(", ") + "."
          : "Услуги мастера «" + master.fullName + "» сняты — в форме записи он не появится.",
        "ok"
      );
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось сохранить услуги", "error");
    }
  }

  async function saveSchedule_(master, scheduleInput, message) {
    ui.setMessage(message, "");
    let items;
    try {
      items = ui.parseSchedule(scheduleInput.value);
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось разобрать график", "error");
      return;
    }

    try {
      await window.API.setMasterSchedule(master.id, items);
      await load();
      showPage("График мастера «" + master.fullName + "» сохранён.", "ok");
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось сохранить график", "error");
    }
  }

  async function toggleMaster(master, button, message) {
    ui.setMessage(message, "");
    button.disabled = true;
    try {
      await window.API.updateMaster(master.id, { isActive: !master.isActive });
      await load();
      showPage(
        master.isActive
          ? "Мастер «" + master.fullName + "» отключён: в форме записи его больше нет."
          : "Мастер «" + master.fullName + "» включён.",
        "ok"
      );
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось изменить мастера", "error");
      button.disabled = false;
    }
  }

  async function deleteMaster(master, message) {
    ui.setMessage(message, "");
    const confirmed = await ui.confirmAction({
      title: "Удалить мастера?",
      text:
        "Если у мастера «" + master.fullName + "» есть записи, сервер не удалит его, а отключит: " +
        "старые записи останутся со своими ценой и длительностью.",
      okLabel: "Удалить",
    });
    if (!confirmed) return;

    try {
      const result = await window.API.deleteMaster(master.id);
      await load();
      showPage((result && result.message) || "Готово.", result && result.deleted ? "ok" : "info");
    } catch (error) {
      ui.setMessage(message, error.message || "Не удалось удалить мастера", "error");
    }
  }

  async function createMaster(event) {
    event.preventDefault();
    ui.setMessage(createMessage, "");

    const data = new FormData(createForm);
    const activeBox = createForm.querySelector('[name="isActive"]');
    const body = {
      fullName: String(data.get("fullName") || "").trim(),
      title: String(data.get("title") || "").trim(),
      serviceIds: selectedIds(createServicesNode),
      isActive: activeBox ? activeBox.checked : true,
    };

    // Аккаунт мастера — необязателен: пустые поля не отправляем.
    const userEmail = String(data.get("userEmail") || "").trim();
    const userPassword = String(data.get("userPassword") || "");
    if (userEmail) {
      body.userEmail = userEmail;
      body.userPassword = userPassword;
    }

    if (!body.fullName) {
      ui.setMessage(createMessage, "Имя мастера не может быть пустым", "error");
      return;
    }
    if (body.userEmail && body.userPassword.length < 8) {
      ui.setMessage(createMessage, "Пароль аккаунта должен быть не короче 8 символов", "error");
      return;
    }

    try {
      const result = await window.API.createMaster(body);
      createForm.reset();
      await load();
      showPage(
        "Мастер «" + ((result && result.master && result.master.fullName) || body.fullName) + "» добавлен.",
        "ok"
      );
    } catch (error) {
      ui.setMessage(createMessage, error.message || "Не удалось добавить мастера", "error");
    }
  }

  /* ---------- Запуск ---------- */

  window.AdminShell.ready.then(function (user) {
    if (!user) return;

    createForm.addEventListener("submit", createMaster);

    load().catch(function (error) {
      showPage(error.message || "Не удалось загрузить мастеров", "error");
    });
  });
})();
