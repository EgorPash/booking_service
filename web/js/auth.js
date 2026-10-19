/* =========================================================
   web/js/auth.js — экран «Вход и регистрация».
   Запросы идут только через window.API (js/api.js):
     POST /api/auth/login, POST /api/auth/register,
     GET  /api/auth/me,    POST /api/auth/logout.
   Токен сессии не читаем и не храним: сервер сам ставит cookie.
   ========================================================= */

"use strict";

(function () {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_RE = /^\+?\d{10,15}$/;

  const formsCard = document.getElementById("auth-forms");
  const sessionCard = document.getElementById("auth-session");
  const sessionEmail = document.getElementById("session-email");
  const logoutButton = document.getElementById("logout-button");
  const messageBox = document.getElementById("auth-message");
  const tabs = Array.prototype.slice.call(document.querySelectorAll(".auth-tab"));
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");

  function normalizePhone(value) {
    return String(value || "").replace(/[\s\-()]/g, "");
  }

  /* ---------- Сообщения и поля ---------- */

  function showFormMessage(text, type) {
    messageBox.textContent = text;
    messageBox.className = "form-message " + (type === "success" ? "is-success" : "is-error");
    messageBox.hidden = false;
  }

  function clearFormMessage() {
    messageBox.textContent = "";
    messageBox.className = "form-message";
    messageBox.hidden = true;
  }

  function setFieldError(form, name, text) {
    const field = form.querySelector('.field[data-field="' + name + '"]');
    const errorNode = form.querySelector('[data-error-for="' + name + '"]');
    if (field) {
      field.classList.add("has-error");
      const input = field.querySelector(".field-input");
      if (input) input.setAttribute("aria-invalid", "true");
    }
    if (errorNode) {
      errorNode.textContent = text;
      errorNode.hidden = false;
    }
  }

  function clearFieldErrors(form) {
    Array.prototype.forEach.call(form.querySelectorAll(".field.has-error"), function (field) {
      field.classList.remove("has-error");
      const input = field.querySelector(".field-input");
      if (input) input.removeAttribute("aria-invalid");
    });
    Array.prototype.forEach.call(form.querySelectorAll(".field-error"), function (node) {
      node.textContent = "";
      node.hidden = true;
    });
  }

  /* ---------- Проверка заполнения (до отправки, для удобства) ---------- */

  function readForm(form) {
    const data = new FormData(form);
    return {
      fullName: String(data.get("fullName") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      email: String(data.get("email") || "").trim(),
      password: String(data.get("password") || ""),
    };
  }

  function validateForm(form) {
    let firstInvalid = null;

    function fail(name, text) {
      setFieldError(form, name, text);
      if (!firstInvalid) {
        firstInvalid = form.querySelector('.field[data-field="' + name + '"] .field-input');
      }
    }

    const data = readForm(form);

    if (form === loginForm) {
      if (!data.email) fail("email", "Укажите email.");
      else if (!EMAIL_RE.test(data.email)) fail("email", "Email выглядит некорректно.");
      if (!data.password) fail("password", "Укажите пароль.");
    } else {
      if (!data.fullName) fail("fullName", "Укажите имя.");
      else if (data.fullName.length > 120) fail("fullName", "Имя слишком длинное (до 120 символов).");

      if (!data.phone) fail("phone", "Укажите телефон.");
      else if (!PHONE_RE.test(normalizePhone(data.phone))) {
        fail("phone", "Телефон выглядит некорректно. Например: +7 900 000-00-00.");
      }

      if (!data.email) fail("email", "Укажите email.");
      else if (!EMAIL_RE.test(data.email)) fail("email", "Email выглядит некорректно.");

      if (!data.password) fail("password", "Укажите пароль.");
      else if (data.password.length < 8) fail("password", "Пароль должен быть не короче 8 символов.");
    }

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  /* ---------- Разбор ошибки сервера ---------- */

  // Сервер не всегда называет поле, но если называет — подсвечиваем его.
  function fieldFromError(error) {
    if (error && error.details && typeof error.details.field === "string") {
      return error.details.field;
    }
    const text = (error && error.message) || "";
    const quoted = text.match(/Поле "([^"]+)"/);
    if (quoted) return quoted[1];
    if (error && error.code === "conflict" && /email/i.test(text)) return "email";
    return null;
  }

  function setBusy(form, busy) {
    const submit = form.querySelector(".auth-submit");
    if (submit) submit.disabled = busy;
  }

  /* ---------- Отправка ---------- */

  function handleSubmit(form, action, buildPayload) {
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      clearFormMessage();
      clearFieldErrors(form);
      if (!validateForm(form)) return;

      setBusy(form, true);
      try {
        await action(buildPayload(readForm(form)));
        window.location.assign("dashboard.html");
      } catch (error) {
        setBusy(form, false);
        const field = fieldFromError(error);
        if (field && form.querySelector('.field[data-field="' + field + '"]')) {
          setFieldError(form, field, error.message);
        }
        showFormMessage(error.message, "error");
      }
    });
  }

  handleSubmit(loginForm, window.API.login, function (data) {
    return { email: data.email, password: data.password };
  });

  handleSubmit(registerForm, window.API.register, function (data) {
    return {
      fullName: data.fullName,
      phone: data.phone,
      email: data.email,
      password: data.password,
    };
  });

  /* ---------- Переключение вкладок ---------- */

  function switchTab(name) {
    tabs.forEach(function (tab) {
      const active = tab.getAttribute("data-tab") === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    });
    loginForm.hidden = name !== "login";
    registerForm.hidden = name !== "register";
    clearFormMessage();
    clearFieldErrors(name === "login" ? loginForm : registerForm);
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      switchTab(tab.getAttribute("data-tab"));
    });
  });

  /* ---------- Показ состояния ---------- */

  function showForms() {
    sessionCard.hidden = true;
    formsCard.hidden = false;
  }

  function showSession(user) {
    formsCard.hidden = true;
    sessionCard.hidden = false;
    sessionEmail.textContent = (user && user.email) || "—";
  }

  /* ---------- Проверка сессии при открытии ---------- */

  async function init() {
    try {
      const data = await window.API.getMe();
      showSession(data ? data.user : null);
    } catch (error) {
      showForms();
      if (error.status && error.status !== 401) {
        showFormMessage("Не удалось проверить сессию: " + error.message, "error");
      }
    }
  }

  logoutButton.addEventListener("click", async function () {
    logoutButton.disabled = true;
    try {
      await window.API.logout();
    } catch (error) {
      // Даже если сервер не ответил — показываем формы.
    }
    logoutButton.disabled = false;
    showForms();
    switchTab("login");
  });

  if (window.location.hash === "#register") {
    switchTab("register");
  }

  init();
})();
