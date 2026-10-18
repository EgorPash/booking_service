"use strict";

const STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"];

const state = {
  user: null,
  roles: [],
  masterId: null,
  clientId: null,
  services: [],
  masters: [],
  booking: { serviceIds: [], masterId: "", date: "", slot: null, holdId: null, holdStartsAt: null },
  detail: null,
  rescheduleSlot: null,
  adminServices: [],
  adminMasters: [],
};

const $ = (id) => document.getElementById(id);

const esc = (value) =>
  String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));

const money = (minor, currency) => (Number(minor) / 100).toFixed(2) + " " + (currency || "RUB");

function setMsg(id, text, kind) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "";
  el.className = "msg" + (kind ? " " + kind : "") + (text ? "" : " hidden");
}

async function api(method, path, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data };
}

function errText(result) {
  if (result.data && typeof result.data === "object") {
    return result.data.message || result.data.error || "HTTP " + result.status;
  }
  if (typeof result.data === "string" && result.data) return result.data;
  return "HTTP " + result.status;
}

function showSection(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.target === name));
  document.querySelectorAll(".section").forEach((s) => s.classList.toggle("active", s.id === "section-" + name));
  if (name === "catalog") loadCatalog();
  if (name === "cabinet") loadMyBookings();
  if (name === "admin") loadAdmin();
}

async function refreshMe() {
  const result = await api("GET", "/api/auth/me");
  if (result.ok) {
    state.user = result.data.user;
    state.roles = result.data.user.roles || [];
    state.masterId = result.data.masterId;
    state.clientId = result.data.clientId;
  } else {
    state.user = null;
    state.roles = [];
    state.masterId = null;
    state.clientId = null;
  }
  renderAuth();
}

function renderAuth() {
  const badge = $("user-badge");
  const logoutBtn = $("logout-btn");
  const adminTab = $("tab-admin");
  if (state.user) {
    const extra = [];
    if (state.masterId) extra.push("мастер #" + state.masterId);
    if (state.clientId) extra.push("клиент #" + state.clientId);
    badge.textContent =
      state.user.email + " [" + state.roles.join(", ") + "]" + (extra.length ? " · " + extra.join(", ") : "");
    badge.classList.remove("hidden");
    logoutBtn.classList.remove("hidden");
    adminTab.classList.toggle("hidden", !state.roles.includes("admin"));
  } else {
    badge.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    adminTab.classList.add("hidden");
    if ($("section-admin").classList.contains("active")) showSection("catalog");
  }
  $("me-box").textContent = state.user ? JSON.stringify(state.user, null, 2) : "не вошли";
}

async function loadCatalog() {
  const [services, masters] = await Promise.all([api("GET", "/api/services"), api("GET", "/api/masters")]);
  if (!services.ok) {
    setMsg("catalog-msg", errText(services), "error");
    return;
  }
  if (!masters.ok) {
    setMsg("catalog-msg", errText(masters), "error");
    return;
  }
  setMsg("catalog-msg", "");
  state.services = services.data.services || [];
  state.masters = masters.data.masters || [];
  renderServicesList();
  renderMastersList();
  renderServiceFilter();
  renderBookingServices();
  renderBookingMasters();
}

async function loadMastersFiltered() {
  const serviceId = $("catalog-service-filter").value;
  const result = await api("GET", "/api/masters" + (serviceId ? "?serviceId=" + encodeURIComponent(serviceId) : ""));
  if (!result.ok) {
    setMsg("catalog-msg", errText(result), "error");
    return;
  }
  state.masters = result.data.masters || [];
  renderMastersList();
  renderBookingMasters();
}

function renderServicesList() {
  const box = $("services-list");
  if (!state.services.length) {
    box.innerHTML = '<p class="hint">Нет услуг.</p>';
    return;
  }
  box.innerHTML =
    "<table><thead><tr><th>ID</th><th>Название</th><th>Длит.</th><th>Цена</th><th>Активна</th></tr></thead><tbody>" +
    state.services
      .map(
        (s) =>
          "<tr><td>" + s.id + "</td><td>" + esc(s.name) +
          (s.description ? '<br><span class="hint">' + esc(s.description) + "</span>" : "") +
          "</td><td>" + s.durationMin + " мин</td><td>" + money(s.priceMinor, s.currency) +
          "</td><td>" + (s.isActive ? "да" : "нет") + "</td></tr>"
      )
      .join("") +
    "</tbody></table>";
}

function serviceNamesByIds(ids) {
  return (ids || [])
    .map((id) => {
      const service = state.services.find((s) => s.id === id);
      return service ? service.name : "#" + id;
    })
    .join(", ");
}

function renderMastersList() {
  const box = $("masters-list");
  if (!state.masters.length) {
    box.innerHTML = '<p class="hint">Нет мастеров.</p>';
    return;
  }
  box.innerHTML =
    "<table><thead><tr><th>ID</th><th>Имя</th><th>Должность</th><th>Услуги</th><th>Активен</th></tr></thead><tbody>" +
    state.masters
      .map(
        (m) =>
          "<tr><td>" + m.id + "</td><td>" + esc(m.fullName) + "</td><td>" + esc(m.title || "—") +
          '</td><td class="hint">' + esc(serviceNamesByIds(m.serviceIds)) + "</td><td>" + (m.isActive ? "да" : "нет") + "</td></tr>"
      )
      .join("") +
    "</tbody></table>";
}

function renderServiceFilter() {
  const select = $("catalog-service-filter");
  const current = select.value;
  select.innerHTML =
    '<option value="">— все —</option>' +
    state.services.map((s) => '<option value="' + s.id + '">' + esc(s.name) + "</option>").join("");
  select.value = current;
}

function renderBookingServices() {
  const box = $("booking-services");
  const active = state.services.filter((s) => s.isActive);
  box.innerHTML = active
    .map(
      (s) =>
        '<label class="chk"><input type="checkbox" value="' + s.id + '"' +
        (state.booking.serviceIds.includes(s.id) ? " checked" : "") + "> " + esc(s.name) +
        " (" + s.durationMin + " мин, " + money(s.priceMinor, s.currency) + ")</label>"
    )
    .join("");
  box.querySelectorAll("input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", () => {
      state.booking.serviceIds = Array.from(box.querySelectorAll("input:checked")).map((i) => Number(i.value));
      state.booking.slot = null;
      renderSlotSelection();
    })
  );
}

function renderBookingMasters() {
  const select = $("booking-master");
  select.innerHTML =
    '<option value="">— выберите —</option>' +
    state.masters
      .filter((m) => m.isActive)
      .map((m) => '<option value="' + m.id + '">' + esc(m.fullName) + (m.title ? " — " + esc(m.title) : "") + "</option>")
      .join("");
  select.value = state.booking.masterId || "";
}

function renderSlots(box, slots, onPick) {
  box.innerHTML = "";
  if (!slots.length) {
    box.innerHTML = '<p class="hint">На эту дату свободного времени нет.</p>';
    return;
  }
  slots.forEach((slot) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot";
    btn.dataset.startsAt = slot.startsAt;
    btn.textContent = slot.time;
    btn.title = slot.startsAt;
    btn.addEventListener("click", () => onPick(slot));
    box.appendChild(btn);
  });
}

function renderSlotSelection() {
  const startsAt = state.booking.slot ? state.booking.slot.startsAt : null;
  document.querySelectorAll("#slots-box button.slot").forEach((b) => b.classList.toggle("selected", b.dataset.startsAt === startsAt));
  $("create-booking").disabled = !startsAt;
  $("hold-slot").disabled = !startsAt;
}

function renderNearest(nearest) {
  const box = $("nearest-box");
  box.innerHTML = "";
  if (!nearest || !nearest.length) return;
  const title = document.createElement("div");
  title.className = "hint";
  title.textContent = "Ближайшие свободные слоты (нажмите, чтобы выбрать):";
  box.appendChild(title);
  nearest.forEach((slot) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot pick";
    btn.textContent = (slot.date || "") + " " + slot.time;
    btn.title = slot.startsAt;
    btn.addEventListener("click", () => {
      if (slot.date) $("booking-date").value = slot.date;
      state.booking.slot = { startsAt: slot.startsAt, endsAt: slot.endsAt, time: slot.time };
      state.booking.holdId = null;
      state.booking.holdStartsAt = null;
      renderSlotSelection();
      setMsg("booking-msg", "Выбрано свободное время: " + slot.date + " " + slot.time + ". Нажмите «Создать запись».", "ok");
    });
    box.appendChild(btn);
  });
}

function onSlotError(result) {
  const nearest = (result.data && result.data.details && result.data.details.nearestSlots) || [];
  setMsg("booking-msg", errText(result) + (nearest.length ? " Ниже — ближайшие свободные варианты." : ""), "error");
  renderNearest(nearest);
}

async function loadSlots() {
  setMsg("booking-msg", "");
  $("nearest-box").innerHTML = "";
  state.booking.serviceIds = Array.from(document.querySelectorAll("#booking-services input:checked")).map((i) => Number(i.value));
  const masterId = Number($("booking-master").value);
  const date = $("booking-date").value;
  if (!masterId) {
    setMsg("booking-msg", "Выберите мастера.", "error");
    return;
  }
  if (!state.booking.serviceIds.length) {
    setMsg("booking-msg", "Выберите хотя бы одну услугу.", "error");
    return;
  }
  if (!date) {
    setMsg("booking-msg", "Укажите дату.", "error");
    return;
  }
  state.booking.masterId = masterId;
  state.booking.date = date;
  const result = await api(
    "GET",
    "/api/masters/" + masterId + "/slots?date=" + encodeURIComponent(date) + "&serviceIds=" + state.booking.serviceIds.join(",")
  );
  if (!result.ok) {
    setMsg("booking-msg", errText(result), "error");
    return;
  }
  state.booking.slot = null;
  state.booking.holdId = null;
  state.booking.holdStartsAt = null;
  renderSlots($("slots-box"), result.data.slots || [], (slot) => {
    state.booking.slot = slot;
    state.booking.holdId = null;
    state.booking.holdStartsAt = null;
    renderSlotSelection();
    setMsg("booking-msg", "Выбрано: " + slot.time + " (" + slot.startsAt + ")", "ok");
  });
  renderSlotSelection();
  setMsg(
    "booking-msg",
    "Свободных слотов: " + (result.data.slots || []).length + ". Длительность " + result.data.durationMin +
      " мин, цена " + money(result.data.priceMinor, result.data.currency) + ". Часовой пояс: " + result.data.timezone + ".",
    "ok"
  );
}

async function holdSlot() {
  if (!state.user) {
    setMsg("booking-msg", "Чтобы удержать слот, войдите или зарегистрируйтесь.", "error");
    return;
  }
  if (!state.booking.slot) {
    setMsg("booking-msg", "Сначала выберите слот.", "error");
    return;
  }
  const result = await api("POST", "/api/holds", {
    masterId: state.booking.masterId,
    serviceIds: state.booking.serviceIds,
    startsAt: state.booking.slot.startsAt,
  });
  if (!result.ok) {
    onSlotError(result);
    return;
  }
  state.booking.holdId = result.data.holdId;
  state.booking.holdStartsAt = state.booking.slot.startsAt;
  setMsg("booking-msg", "Слот удержан до " + result.data.expiresAt + " (holdId: " + result.data.holdId + ").", "ok");
}

async function createBooking() {
  if (!state.user) {
    setMsg("booking-msg", "Чтобы создать запись, войдите или зарегистрируйтесь.", "error");
    return;
  }
  if (!state.booking.slot) {
    setMsg("booking-msg", "Сначала выберите слот.", "error");
    return;
  }
  const body = {
    masterId: state.booking.masterId,
    serviceIds: state.booking.serviceIds,
    startsAt: state.booking.slot.startsAt,
  };
  const comment = $("booking-comment").value.trim();
  if (comment) body.comment = comment;
  const fullName = $("booking-fullname").value.trim();
  if (fullName) body.fullName = fullName;
  const phone = $("booking-phone").value.trim();
  if (phone) body.phone = phone;
  if (state.booking.holdId && state.booking.holdStartsAt === state.booking.slot.startsAt) {
    body.holdToken = state.booking.holdId;
  }
  const result = await api("POST", "/api/bookings", body);
  if (!result.ok) {
    onSlotError(result);
    return;
  }
  $("nearest-box").innerHTML = "";
  const created = result.data.bookings || [];
  setMsg(
    "booking-msg",
    "Создано записей: " + created.length + " (ID " + created.map((b) => b.id).join(", ") + "). Итог: " +
      money(result.data.priceMinor, result.data.currency) + ", " + result.data.durationMin + " мин.",
    "ok"
  );
  state.booking.holdId = null;
  state.booking.holdStartsAt = null;
  await loadSlots();
}

function localText(local) {
  return local ? esc(local.date) + " " + esc(local.time) : "—";
}

async function loadMyBookings() {
  setMsg("cabinet-msg", "");
  const result = await api("GET", "/api/bookings/my");
  if (!result.ok) {
    setMsg("cabinet-msg", errText(result), "error");
    return;
  }
  renderMyBookings(result.data.bookings || []);
}

function renderMyBookings(list) {
  const box = $("my-bookings");
  if (!list.length) {
    box.innerHTML = '<p class="hint">Записей нет.</p>';
    return;
  }
  box.innerHTML =
    "<table><thead><tr><th>ID</th><th>Статус</th><th>Когда</th><th>Мастер</th><th>Услуга</th><th>Цена</th><th></th></tr></thead><tbody>" +
    list
      .map(
        (b) =>
          "<tr><td>" + b.id + "</td><td>" + '<span class="badge">' + esc(b.status) + "</span></td><td>" +
          localText(b.startsAtLocal) + "</td><td>" + esc(b.master.fullName) + "</td><td>" + esc(b.service.name) +
          "</td><td>" + money(b.priceMinor, b.currency) + '</td><td><button class="btn" data-open="' + b.id + '">Детали</button></td></tr>'
      )
      .join("") +
    "</tbody></table>";
  box.querySelectorAll("[data-open]").forEach((btn) =>
    btn.addEventListener("click", () => openDetail(Number(btn.dataset.open)))
  );
}

async function openDetail(id) {
  setMsg("detail-msg", "");
  const result = await api("GET", "/api/bookings/" + id);
  if (!result.ok) {
    setMsg("cabinet-msg", errText(result), "error");
    return;
  }
  state.detail = result.data.booking;
  state.rescheduleSlot = null;
  $("detail-card").classList.remove("hidden");
  $("detail-id").textContent = "#" + state.detail.id;
  renderDetail();
}

function renderDetail() {
  const b = state.detail;
  const rows = [
    ["Статус", b.status],
    ["Начало (UTC)", b.startsAt],
    ["Начало (местное)", b.startsAtLocal ? b.startsAtLocal.date + " " + b.startsAtLocal.time : "—"],
    ["Длительность", b.durationMin + " мин"],
    ["Цена", money(b.priceMinor, b.currency)],
    ["Мастер", b.master.fullName + " (#" + b.master.id + ")"],
    ["Услуга", b.service.name + " (#" + b.service.id + ")"],
    ["Клиент", b.client.fullName + " (" + (b.client.phone || "") + ") #" + b.client.id],
    ["Комментарий", b.comment || "—"],
    ["Наложение (allowOverlap)", b.allowOverlap ? "да" : "нет"],
  ];
  $("booking-detail").innerHTML =
    '<div class="pre">' + rows.map(([k, v]) => esc(k) + ": " + esc(v)).join("\n") + "</div>";
  $("reschedule-date").value = b.startsAtLocal ? b.startsAtLocal.date : "";
  $("reschedule-btn").disabled = !state.rescheduleSlot;
  $("reschedule-slots").innerHTML = "";
}

async function loadRescheduleSlots() {
  setMsg("detail-msg", "");
  if (!state.detail) return;
  const date = $("reschedule-date").value;
  if (!date) {
    setMsg("detail-msg", "Укажите новую дату.", "error");
    return;
  }
  const masterId = state.detail.master.id;
  const serviceIds = [state.detail.service.id];
  const result = await api(
    "GET",
    "/api/masters/" + masterId + "/slots?date=" + encodeURIComponent(date) + "&serviceIds=" + serviceIds.join(",")
  );
  if (!result.ok) {
    setMsg("detail-msg", errText(result), "error");
    return;
  }
  state.rescheduleSlot = null;
  $("reschedule-btn").disabled = true;
  renderSlots($("reschedule-slots"), result.data.slots || [], (slot) => {
    state.rescheduleSlot = slot;
    $("reschedule-btn").disabled = false;
    document.querySelectorAll("#reschedule-slots button.slot").forEach((b) =>
      b.classList.toggle("selected", b.dataset.startsAt === slot.startsAt)
    );
    setMsg("detail-msg", "Новое время: " + date + " " + slot.time, "ok");
  });
  setMsg("detail-msg", "Свободных слотов: " + (result.data.slots || []).length + ".", "ok");
}

async function rescheduleBooking() {
  if (!state.detail || !state.rescheduleSlot) return;
  const result = await api("PATCH", "/api/bookings/" + state.detail.id, { startsAt: state.rescheduleSlot.startsAt });
  if (!result.ok) {
    const nearest = (result.data && result.data.details && result.data.details.nearestSlots) || [];
    setMsg(
      "detail-msg",
      errText(result) + (nearest.length ? " Свободно: " + nearest.map((s) => s.date + " " + s.time).join("; ") : ""),
      "error"
    );
    return;
  }
  state.detail = result.data.booking;
  state.rescheduleSlot = null;
  renderDetail();
  setMsg(
    "detail-msg",
    "Запись перенесена на " + result.data.booking.startsAtLocal.date + " " + result.data.booking.startsAtLocal.time + ".",
    "ok"
  );
  loadMyBookings();
}

async function cancelBooking() {
  if (!state.detail) return;
  const result = await api("POST", "/api/bookings/" + state.detail.id + "/cancel");
  if (!result.ok) {
    setMsg("detail-msg", errText(result), "error");
    return;
  }
  state.detail = result.data.booking;
  renderDetail();
  setMsg("detail-msg", "Запись отменена.", "ok");
  loadMyBookings();
}

function loadAdmin() {
  loadAdminBookings();
  loadAdminServices();
  loadAdminMasters();
  loadStudio();
}

async function loadAdminBookings() {
  setMsg("admin-bookings-msg", "");
  const params = new URLSearchParams();
  const status = $("admin-status-filter").value;
  if (status) params.set("status", status);
  const masterId = $("admin-master-filter").value;
  if (masterId) params.set("masterId", masterId);
  const clientId = $("admin-client-filter").value;
  if (clientId) params.set("clientId", clientId);
  const date = $("admin-date-filter").value;
  if (date) params.set("date", date);
  const query = params.toString();
  const result = await api("GET", "/api/admin/bookings" + (query ? "?" + query : ""));
  if (!result.ok) {
    setMsg("admin-bookings-msg", errText(result), "error");
    return;
  }
  renderAdminBookings(result.data.bookings || []);
}

function renderAdminBookings(list) {
  const box = $("admin-bookings");
  if (!list.length) {
    box.innerHTML = '<p class="hint">Записей нет.</p>';
    return;
  }
  box.innerHTML =
    "<table><thead><tr><th>ID</th><th>Когда</th><th>Мастер</th><th>Клиент</th><th>Услуга</th><th>Цена</th><th>Статус</th><th></th></tr></thead><tbody>" +
    list
      .map(
        (b) =>
          "<tr><td>" + b.id + "</td><td>" + localText(b.startsAtLocal) + "</td><td>" + esc(b.master.fullName) +
          "</td><td>" + esc(b.client.fullName) + " (#" + b.client.id + ")</td><td>" + esc(b.service.name) +
          "</td><td>" + money(b.priceMinor, b.currency) + '</td><td><select data-status="' + b.id + '">' +
          STATUSES.map((s) => '<option value="' + s + '"' + (s === b.status ? " selected" : "") + ">" + s + "</option>").join("") +
          '</select></td><td><button class="btn" data-setstatus="' + b.id + '">Сменить</button></td></tr>'
      )
      .join("") +
    "</tbody></table>";
  box.querySelectorAll("[data-setstatus]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const id = btn.dataset.setstatus;
      const select = box.querySelector('[data-status="' + id + '"]');
      const result = await api("PATCH", "/api/admin/bookings/" + id + "/status", { status: select.value });
      if (!result.ok) {
        setMsg("admin-bookings-msg", errText(result), "error");
        return;
      }
      setMsg("admin-bookings-msg", "Статус записи #" + id + " → " + result.data.booking.status, "ok");
      loadAdminBookings();
    })
  );
}

async function loadAdminServices() {
  setMsg("admin-services-msg", "");
  const result = await api("GET", "/api/admin/services");
  if (!result.ok) {
    setMsg("admin-services-msg", errText(result), "error");
    return;
  }
  state.adminServices = result.data.services || [];
  renderAdminServices();
  renderMasterCreateServices();
}

function renderAdminServices() {
  const box = $("admin-services");
  if (!state.adminServices.length) {
    box.innerHTML = '<p class="hint">Нет услуг.</p>';
    return;
  }
  box.innerHTML = state.adminServices
    .map(
      (s) =>
        '<div class="item" data-service="' + s.id + '">' +
        '<div class="item-head"><strong>#' + s.id + " " + esc(s.name) + '</strong><span class="badge">' +
        (s.isActive ? "активна" : "выключена") + "</span></div>" +
        '<div class="inline-form">' +
        '<label>Название<input data-f="name" value="' + esc(s.name) + '"></label>' +
        '<label>Длительность, мин<input data-f="durationMin" type="number" min="1" value="' + s.durationMin + '"></label>' +
        '<label>Цена, коп.<input data-f="priceMinor" type="number" min="0" value="' + s.priceMinor + '"></label>' +
        '<label class="chk"><input data-f="isActive" type="checkbox"' + (s.isActive ? " checked" : "") + "> активна</label>" +
        "</div>" +
        '<div class="row"><button class="btn primary" data-save-service="' + s.id + '">Сохранить</button>' +
        '<button class="btn danger" data-del-service="' + s.id + '">Выключить</button></div>' +
        "</div>"
    )
    .join("");
  box.querySelectorAll("[data-save-service]").forEach((btn) =>
    btn.addEventListener("click", () => saveService(Number(btn.dataset.saveService)))
  );
  box.querySelectorAll("[data-del-service]").forEach((btn) =>
    btn.addEventListener("click", () => deleteService(Number(btn.dataset.delService)))
  );
}

async function saveService(id) {
  const item = document.querySelector('[data-service="' + id + '"]');
  const body = {
    name: item.querySelector('[data-f="name"]').value.trim(),
    durationMin: Number(item.querySelector('[data-f="durationMin"]').value),
    priceMinor: Number(item.querySelector('[data-f="priceMinor"]').value),
    isActive: item.querySelector('[data-f="isActive"]').checked,
  };
  const result = await api("PATCH", "/api/admin/services/" + id, body);
  if (!result.ok) {
    setMsg("admin-services-msg", errText(result), "error");
    return;
  }
  setMsg("admin-services-msg", "Услуга #" + id + " сохранена.", "ok");
  loadAdminServices();
}

async function deleteService(id) {
  const result = await api("DELETE", "/api/admin/services/" + id);
  if (!result.ok) {
    setMsg("admin-services-msg", errText(result), "error");
    return;
  }
  setMsg("admin-services-msg", "Услуга #" + id + " выключена.", "ok");
  loadAdminServices();
}

async function loadAdminMasters() {
  setMsg("admin-masters-msg", "");
  const result = await api("GET", "/api/admin/masters");
  if (!result.ok) {
    setMsg("admin-masters-msg", errText(result), "error");
    return;
  }
  state.adminMasters = result.data.masters || [];
  renderAdminMasters();
  renderMasterCreateServices();
}

function renderMasterCreateServices() {
  $("master-create-services").innerHTML = state.adminServices
    .map((s) => '<option value="' + s.id + '">' + esc(s.name) + "</option>")
    .join("");
}

function defaultSchedule() {
  const items = [];
  for (let weekday = 1; weekday <= 6; weekday += 1) {
    items.push({ weekday, startTime: "10:00", endTime: "20:00" });
  }
  return JSON.stringify(items);
}

function renderAdminMasters() {
  const box = $("admin-masters");
  if (!state.adminMasters.length) {
    box.innerHTML = '<p class="hint">Нет мастеров.</p>';
    return;
  }
  box.innerHTML = state.adminMasters
    .map(
      (m) =>
        '<div class="item" data-master="' + m.id + '">' +
        '<div class="item-head"><strong>#' + m.id + " " + esc(m.fullName) + '</strong><span class="badge">' +
        (m.isActive ? "активен" : "выключен") + "</span></div>" +
        '<div class="inline-form">' +
        '<label>Имя<input data-f="fullName" value="' + esc(m.fullName) + '"></label>' +
        '<label>Должность<input data-f="title" value="' + esc(m.title || "") + '"></label>' +
        '<label>Био<input data-f="bio" value="' + esc(m.bio || "") + '"></label>' +
        '<label class="chk"><input data-f="isActive" type="checkbox"' + (m.isActive ? " checked" : "") + "> активен</label>" +
        "</div>" +
        '<label>Услуги (Ctrl/Cmd — несколько)<select multiple size="5" data-f="serviceIds">' +
        state.adminServices
          .map(
            (s) =>
              '<option value="' + s.id + '"' + ((m.serviceIds || []).includes(s.id) ? " selected" : "") + ">" + esc(s.name) + "</option>"
          )
          .join("") +
        "</select></label>" +
        '<label>График (JSON)<textarea data-f="schedule">' + esc(defaultSchedule()) + "</textarea></label>" +
        '<div class="row">' +
        '<button class="btn primary" data-save-master="' + m.id + '">Сохранить профиль</button>' +
        '<button class="btn" data-save-services="' + m.id + '">Сохранить услуги</button>' +
        '<button class="btn" data-save-schedule="' + m.id + '">Сохранить график</button>' +
        '<button class="btn danger" data-del-master="' + m.id + '">Выключить</button>' +
        "</div>" +
        "</div>"
    )
    .join("");
  box.querySelectorAll("[data-save-master]").forEach((btn) =>
    btn.addEventListener("click", () => saveMasterProfile(Number(btn.dataset.saveMaster)))
  );
  box.querySelectorAll("[data-save-services]").forEach((btn) =>
    btn.addEventListener("click", () => saveMasterServices(Number(btn.dataset.saveServices)))
  );
  box.querySelectorAll("[data-save-schedule]").forEach((btn) =>
    btn.addEventListener("click", () => saveMasterSchedule(Number(btn.dataset.saveSchedule)))
  );
  box.querySelectorAll("[data-del-master]").forEach((btn) =>
    btn.addEventListener("click", () => deleteMaster(Number(btn.dataset.delMaster)))
  );
}

function masterItem(id) {
  return document.querySelector('[data-master="' + id + '"]');
}

async function saveMasterProfile(id) {
  const item = masterItem(id);
  const body = {
    fullName: item.querySelector('[data-f="fullName"]').value.trim(),
    title: item.querySelector('[data-f="title"]').value.trim(),
    bio: item.querySelector('[data-f="bio"]').value.trim(),
    isActive: item.querySelector('[data-f="isActive"]').checked,
  };
  const result = await api("PATCH", "/api/admin/masters/" + id, body);
  if (!result.ok) {
    setMsg("admin-masters-msg", errText(result), "error");
    return;
  }
  setMsg("admin-masters-msg", "Профиль мастера #" + id + " сохранён.", "ok");
  loadAdminMasters();
}

async function saveMasterServices(id) {
  const item = masterItem(id);
  const serviceIds = Array.from(item.querySelector('[data-f="serviceIds"]').selectedOptions).map((o) => Number(o.value));
  const result = await api("PUT", "/api/admin/masters/" + id + "/services", { serviceIds });
  if (!result.ok) {
    setMsg("admin-masters-msg", errText(result), "error");
    return;
  }
  setMsg("admin-masters-msg", "Услуги мастера #" + id + " сохранены.", "ok");
  loadAdminMasters();
}

async function saveMasterSchedule(id) {
  const item = masterItem(id);
  let schedule;
  try {
    schedule = JSON.parse(item.querySelector('[data-f="schedule"]').value);
  } catch (error) {
    setMsg("admin-masters-msg", "График: некорректный JSON.", "error");
    return;
  }
  const result = await api("PUT", "/api/admin/masters/" + id + "/schedule", { schedule });
  if (!result.ok) {
    setMsg("admin-masters-msg", errText(result), "error");
    return;
  }
  setMsg("admin-masters-msg", "График мастера #" + id + " сохранён.", "ok");
}

async function deleteMaster(id) {
  const result = await api("DELETE", "/api/admin/masters/" + id);
  if (!result.ok) {
    setMsg("admin-masters-msg", errText(result), "error");
    return;
  }
  setMsg("admin-masters-msg", "Мастер #" + id + " выключен.", "ok");
  loadAdminMasters();
}

async function loadStudio() {
  setMsg("studio-msg", "");
  const result = await api("GET", "/api/admin/studio");
  if (!result.ok) {
    setMsg("studio-msg", errText(result), "error");
    return;
  }
  const s = result.data.studio;
  const form = $("studio-form");
  form.timezone.value = s.timezone || "";
  form.openingTime.value = s.openingTime || "";
  form.closingTime.value = s.closingTime || "";
  form.slotStepMinutes.value = s.slotStepMinutes == null ? "" : s.slotStepMinutes;
  form.holdTtlMinutes.value = s.holdTtlMinutes == null ? "" : s.holdTtlMinutes;
}

function init() {
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      const target = tab.dataset.target;
      if (target === "cabinet" && !state.user) {
        setMsg("global-msg", "Сначала войдите или зарегистрируйтесь.", "error");
        showSection("auth");
        return;
      }
      if (target === "admin" && !state.roles.includes("admin")) {
        setMsg("global-msg", "Нужна роль администратора.", "error");
        showSection("auth");
        return;
      }
      setMsg("global-msg", "");
      showSection(target);
    })
  );

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const result = await api("POST", "/api/auth/login", {
      email: form.email.value.trim(),
      password: form.password.value,
    });
    if (!result.ok) {
      setMsg("login-msg", errText(result), "error");
      return;
    }
    setMsg("login-msg", "Вход выполнен: " + result.data.user.email, "ok");
    form.reset();
    await refreshMe();
    loadCatalog();
  });

  $("register-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const result = await api("POST", "/api/auth/register", {
      fullName: form.fullName.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      password: form.password.value,
    });
    if (!result.ok) {
      setMsg("register-msg", errText(result), "error");
      return;
    }
    setMsg("register-msg", "Зарегистрирован клиент #" + result.data.client.id + ", выполнен вход.", "ok");
    form.reset();
    await refreshMe();
    showSection("catalog");
  });

  $("logout-btn").addEventListener("click", async () => {
    await api("POST", "/api/auth/logout");
    await refreshMe();
    showSection("auth");
  });

  $("load-catalog").addEventListener("click", loadCatalog);
  $("catalog-service-filter").addEventListener("change", loadMastersFiltered);
  $("booking-master").addEventListener("change", () => {
    state.booking.masterId = $("booking-master").value;
    state.booking.slot = null;
    renderSlotSelection();
  });
  $("booking-date").addEventListener("change", () => {
    state.booking.slot = null;
    renderSlotSelection();
  });
  $("load-slots").addEventListener("click", loadSlots);
  $("hold-slot").addEventListener("click", holdSlot);
  $("create-booking").addEventListener("click", createBooking);
  $("load-my").addEventListener("click", loadMyBookings);
  $("load-reschedule-slots").addEventListener("click", loadRescheduleSlots);
  $("reschedule-btn").addEventListener("click", rescheduleBooking);
  $("cancel-btn").addEventListener("click", cancelBooking);
  $("load-admin-bookings").addEventListener("click", loadAdminBookings);

  $("service-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = {
      name: form.name.value.trim(),
      durationMin: Number(form.durationMin.value),
      priceMinor: Number(form.priceMinor.value),
      isActive: form.isActive.checked,
    };
    const description = form.description.value.trim();
    if (description) body.description = description;
    const result = await api("POST", "/api/admin/services", body);
    if (!result.ok) {
      setMsg("admin-services-msg", errText(result), "error");
      return;
    }
    setMsg("admin-services-msg", "Услуга #" + result.data.service.id + " добавлена.", "ok");
    form.reset();
    form.isActive.checked = true;
    loadAdminServices();
  });

  $("master-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = {
      fullName: form.fullName.value.trim(),
      serviceIds: Array.from(form.serviceIds.selectedOptions).map((o) => Number(o.value)),
    };
    const title = form.title.value.trim();
    if (title) body.title = title;
    const userEmail = form.userEmail.value.trim();
    if (userEmail) {
      body.userEmail = userEmail;
      body.userPassword = form.userPassword.value;
    }
    const result = await api("POST", "/api/admin/masters", body);
    if (!result.ok) {
      setMsg("admin-masters-msg", errText(result), "error");
      return;
    }
    setMsg("admin-masters-msg", "Мастер #" + result.data.master.id + " добавлен.", "ok");
    form.reset();
    loadAdminMasters();
  });

  $("studio-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const body = {
      timezone: form.timezone.value.trim(),
      openingTime: form.openingTime.value.trim(),
      closingTime: form.closingTime.value.trim(),
    };
    if (form.slotStepMinutes.value) body.slotStepMinutes = Number(form.slotStepMinutes.value);
    if (form.holdTtlMinutes.value) body.holdTtlMinutes = Number(form.holdTtlMinutes.value);
    const result = await api("PATCH", "/api/admin/studio", body);
    if (!result.ok) {
      setMsg("studio-msg", errText(result), "error");
      return;
    }
    setMsg("studio-msg", "Настройки студии сохранены.", "ok");
    loadStudio();
  });

  refreshMe().then(() => {
    loadCatalog();
  });
}

document.addEventListener("DOMContentLoaded", init);
