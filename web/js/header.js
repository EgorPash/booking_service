/* =========================================================
   web/js/header.js — общая шапка клиента в одном месте.
   Страницы вставляют пустой контейнер:
       <header class="site-header" data-client-header></header>
   и подключают этот файл — разметка шапки больше не дублируется.
   Имя вошедшего клиента берётся из API:
     GET /api/auth/me   — вошёл ли пользователь;
     GET /api/bookings/my — имя клиента (client.fullName).
   Если клиент не вошёл — показываем кнопки входа и регистрации.
   ========================================================= */

"use strict";

(function () {
  const mount = document.querySelector("[data-client-header]");
  if (!mount) return;

  // Глобальная навигация клиента: прототип (лого, «Главная», «Записаться»)
  // + переходы личного кабинета из docs/ui-map.md (Профиль, Уведомления).
  const LINKS = [
    { label: "Главная", href: "index.html" },
    { label: "Записаться", href: "booking.html" },
    { label: "Профиль", href: "profile.html" },
    { label: "Уведомления", href: "notifications.html" },
  ];

  const here = window.location.pathname.split("/").pop() || "index.html";

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

  function build() {
    mount.classList.add("client-header");
    const inner = el("div", "container header-inner");

    const logo = el("a", "logo");
    logo.href = "index.html";
    logo.setAttribute("aria-label", "Lumi Beauty Studio — на главную");
    logo.appendChild(el("span", "logo-mark", "L"));
    const logoText = el("span", "logo-text");
    logoText.appendChild(el("span", "logo-strong", "Lumi"));
    logoText.appendChild(document.createTextNode(" "));
    logoText.appendChild(el("span", "logo-soft", "Beauty Studio"));
    logo.appendChild(logoText);

    const nav = el("nav", "nav");
    nav.setAttribute("aria-label", "Основная навигация");
    LINKS.forEach(function (item) {
      const link = el("a", "nav-link", item.label);
      link.href = item.href;
      if (item.href === here) link.classList.add("active");
      nav.appendChild(link);
    });

    const actions = el("div", "header-actions");
    actions.id = "header-actions";

    inner.appendChild(logo);
    inner.appendChild(nav);
    inner.appendChild(actions);
    mount.appendChild(inner);
  }

  function renderGuest() {
    const actions = document.getElementById("header-actions");
    actions.innerHTML = "";

    const login = el("a", "btn btn-ghost", "Войти");
    login.href = "auth.html";

    const register = el("a", "btn btn-primary", "Регистрация");
    register.href = "auth.html#register";

    actions.appendChild(login);
    actions.appendChild(register);
  }

  function renderUser(user, name) {
    const actions = document.getElementById("header-actions");
    actions.innerHTML = "";

    const display =
      (name && name.trim()) ||
      String((user && user.email) || "").split("@")[0] ||
      "Профиль";

    const chip = el("span", "user-chip");
    chip.appendChild(el("span", "user-avatar", initials(name || display)));
    const nameNode = el("span", "user-name", display);
    nameNode.title = display;
    chip.appendChild(nameNode);

    const logout = el("button", "btn btn-ghost", "Выйти");
    logout.type = "button";
    logout.addEventListener("click", async function () {
      logout.disabled = true;
      try {
        await window.API.logout();
      } catch (error) {
        // даже если сервер не ответил — уводим на экран входа
      }
      window.location.assign("auth.html");
    });

    actions.appendChild(chip);
    actions.appendChild(logout);
  }

  async function load() {
    let me;
    try {
      me = await window.API.getMe();
    } catch (error) {
      renderGuest();
      return;
    }

    if (!me || !me.user) {
      renderGuest();
      return;
    }

    let name = null;
    try {
      const data = await window.API.getMyBookings();
      const first = data && data.bookings && data.bookings[0];
      if (first && first.client && first.client.fullName) {
        name = first.client.fullName;
      }
    } catch (error) {
      // имя — необязательное: покажем email, если записей/имени нет
    }

    renderUser(me.user, name);
  }

  build();
  renderGuest();
  load();
})();
