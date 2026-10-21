/* =========================================================
   web/js/admin.js — каркас админ-раздела (/admin).
   Собирает шапку админ-панели: лого, меню разделов («Записи»,
   «Услуги», «Мастера»), пользователя и выход.

   Правила:
   - запросы идут только через window.API (js/api.js);
   - доступ проверяет сервер: GET /api/admin/access отдаёт 403,
     если у пользователя нет роли admin. Роли приходят из БД
     списком, поэтому проверяем вхождение роли в список;
   - страницы разделов (Услуги, Мастера) подключаются отдельно
     и ждут window.AdminShell.ready.
   ========================================================= */

"use strict";

(function () {
  const SECTIONS = [
    { id: "bookings", label: "Записи", href: "bookings.html" },
    { id: "services", label: "Услуги", href: "services.html" },
    { id: "masters", label: "Мастера", href: "masters.html" },
  ];

  const DENIED_TITLE = "Этот раздел только для администраторов";
  const DENIED_TEXT =
    "У вашей учётной записи нет роли администратора, поэтому админ-раздел недоступен.";

  const headerMount = document.querySelector("[data-admin-header]");
  const bodyNode = document.querySelector("[data-admin-body]");
  const pageNode = document.querySelector("[data-admin-page]");
  const current = pageNode ? pageNode.getAttribute("data-admin-page") || "" : "";

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

  /* ---------- Шапка админ-панели ---------- */

  function buildHeader() {
    if (!headerMount) return;

    headerMount.classList.add("client-header");
    const inner = el("div", "container header-inner");

    const logo = el("a", "logo");
    logo.href = "../index.html";
    logo.setAttribute("aria-label", "Lumi Beauty Studio — на главную");
    logo.appendChild(el("span", "logo-mark", "L"));
    const logoText = el("span", "logo-text");
    logoText.appendChild(el("span", "logo-strong", "Lumi"));
    logoText.appendChild(document.createTextNode(" "));
    logoText.appendChild(el("span", "logo-soft", "Beauty Studio"));
    logo.appendChild(logoText);

    const nav = el("nav", "nav");
    nav.id = "admin-nav";
    nav.setAttribute("aria-label", "Разделы админ-панели");
    SECTIONS.forEach(function (section) {
      const link = el("a", "nav-link", section.label);
      link.href = section.href;
      if (section.id === current) link.classList.add("active");
      nav.appendChild(link);
    });

    const navToggle = el("button", "nav-toggle");
    navToggle.type = "button";
    navToggle.setAttribute("aria-label", "Открыть меню");
    navToggle.setAttribute("aria-controls", "admin-nav");
    navToggle.setAttribute("aria-expanded", "false");
    for (let i = 0; i < 3; i += 1) navToggle.appendChild(el("span"));

    const actions = el("div", "header-actions");
    actions.id = "admin-header-actions";

    function setNav(open) {
      headerMount.classList.toggle("nav-open", open);
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
      navToggle.setAttribute("aria-label", open ? "Закрыть меню" : "Открыть меню");
    }

    navToggle.addEventListener("click", function (event) {
      event.stopPropagation();
      setNav(!headerMount.classList.contains("nav-open"));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setNav(false);
    });

    document.addEventListener("click", function (event) {
      if (!headerMount.classList.contains("nav-open")) return;
      if (headerMount.contains(event.target)) return;
      setNav(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && headerMount.classList.contains("nav-open")) {
        setNav(false);
      }
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth > 720) setNav(false);
    });

    inner.appendChild(logo);
    inner.appendChild(nav);
    inner.appendChild(navToggle);
    inner.appendChild(actions);
    headerMount.appendChild(inner);
  }

  function renderUser(user) {
    const actions = document.getElementById("admin-header-actions");
    if (!actions) return;

    actions.innerHTML = "";

    const display = String((user && user.email) || "").split("@")[0] || "Профиль";

    const chip = el("span", "user-chip");
    chip.appendChild(el("span", "user-avatar", initials(display)));
    const nameNode = el("span", "user-name", display);
    nameNode.title = (user && user.email) || display;
    chip.appendChild(nameNode);

    const logout = el("button", "btn btn-ghost", "Выйти");
    logout.type = "button";
    logout.id = "admin-logout-button";
    logout.addEventListener("click", async function () {
      logout.disabled = true;
      try {
        await window.API.logout();
      } catch (error) {
        // даже если сервер не ответил — уводим на экран входа
      }
      window.location.assign("/auth.html");
    });

    actions.appendChild(chip);
    actions.appendChild(logout);
  }

  /* ---------- Отказ в доступе ---------- */

  function renderDenied() {
    if (!bodyNode) return;

    bodyNode.innerHTML = "";

    const box = el("div", "admin-denied");
    box.appendChild(el("span", "eyebrow", "Lumi Beauty Studio"));
    box.appendChild(el("h1", "section-title", DENIED_TITLE));
    box.appendChild(el("p", "admin-denied-text", DENIED_TEXT));

    const actions = el("div", "admin-denied-actions");
    const login = el("a", "btn btn-primary", "Войти");
    login.href = "/auth.html";
    const home = el("a", "btn btn-ghost", "На главную");
    home.href = "/index.html";
    actions.appendChild(login);
    actions.appendChild(home);
    box.appendChild(actions);

    bodyNode.appendChild(box);
  }

  /* ---------- Запуск ---------- */

  function init() {
    buildHeader();

    // Серверная проверка прав: 403, если роли admin нет.
    return window.API
      .getAdminAccess()
      .then(function (data) {
        return data && data.user ? data.user : null;
      })
      .catch(function () {
        return null;
      })
      .then(function (user) {
        if (!user) {
          renderDenied();
          return null;
        }
        renderUser(user);
        return user;
      });
  }

  // Страницы разделов ждут this.ready: null — доступа нет,
  // тогда страница ничего не грузит (отказ покажет этот же файл).
  window.AdminShell = { ready: init() };
})();
