/* =========================================================
   web/js/landing.js — лендинг клиента.
   Данные берём только через window.API (js/api.js).
   Пока данные грузятся — показываем скелетоны;
   ошибки API показываем текстом прямо в блоке.
   ========================================================= */

"use strict";

(function () {
  const servicesList = document.getElementById("services-list");
  const mastersList = document.getElementById("masters-list");

  const serviceNameById = new Map();

  const SERVICE_ICON =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>' +
    '<circle cx="12" cy="12" r="4"/></svg>';

  /* ---------- Форматирование ---------- */

  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function formatDuration(min) {
    if (!Number.isFinite(min) || min <= 0) return "—";
    const hours = Math.floor(min / 60);
    const minutes = min % 60;
    const parts = [];
    if (hours) parts.push(hours + " " + plural(hours, "час", "часа", "часов"));
    if (minutes) {
      parts.push(minutes + " " + plural(minutes, "минута", "минуты", "минут"));
    }
    return parts.join(" ");
  }

  function formatPrice(priceMinor, currency) {
    if (!Number.isFinite(priceMinor)) return "—";
    const value = priceMinor / 100;
    try {
      return new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: currency || "RUB",
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      }).format(value);
    } catch (formatError) {
      return value + " " + (currency || "");
    }
  }

  function initial(fullName) {
    const text = String(fullName || "").trim();
    return text ? text.charAt(0).toUpperCase() : "?";
  }

  /* ---------- Создание элементов ---------- */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function iconBox(className) {
    const box = el("div", className);
    box.innerHTML = SERVICE_ICON;
    return box;
  }

  function showMessage(container, className, text) {
    container.innerHTML = "";
    container.appendChild(el("p", className, text));
  }

  /* ---------- Скелетоны ---------- */

  function skeletonCard(kind) {
    const card = el("article", "card " + kind + "-card");
    card.appendChild(el("div", "skeleton " + (kind === "service" ? "skeleton-icon" : "skeleton-avatar")));
    card.appendChild(el("div", "skeleton skeleton-line short"));
    card.appendChild(el("div", "skeleton skeleton-line"));
    card.appendChild(el("div", "skeleton skeleton-line short"));
    return card;
  }

  function renderSkeletons() {
    servicesList.innerHTML = "";
    for (let i = 0; i < 3; i += 1) servicesList.appendChild(skeletonCard("service"));

    mastersList.innerHTML = "";
    for (let i = 0; i < 3; i += 1) mastersList.appendChild(skeletonCard("master"));
  }

  /* ---------- Услуги ---------- */

  function renderServices(services) {
    servicesList.innerHTML = "";

    if (!services || !services.length) {
      servicesList.appendChild(
        el("p", "data-empty", "Пока нет доступных услуг. Загляните позже.")
      );
      return;
    }

    services.forEach(function (service) {
      serviceNameById.set(service.id, service.name);

      const card = el("article", "card service-card");
      card.appendChild(iconBox("service-icon"));
      card.appendChild(el("h3", "card-title", service.name));
      if (service.description) {
        card.appendChild(el("p", "card-text", service.description));
      }

      const meta = el("div", "card-meta");
      meta.appendChild(el("span", "duration", formatDuration(service.durationMin)));
      meta.appendChild(
        el("span", "price", formatPrice(service.priceMinor, service.currency))
      );
      card.appendChild(meta);

      servicesList.appendChild(card);
    });
  }

  /* ---------- Мастера ---------- */

  function renderMasters(masters) {
    mastersList.innerHTML = "";

    if (!masters || !masters.length) {
      mastersList.appendChild(
        el("p", "data-empty", "Список мастеров пока пуст.")
      );
      return;
    }

    masters.forEach(function (master) {
      const card = el("article", "card master-card");
      card.appendChild(el("div", "master-avatar", initial(master.fullName)));
      card.appendChild(el("h3", "card-title", master.fullName));
      if (master.title) {
        card.appendChild(el("p", "master-role", master.title));
      }
      if (master.bio) {
        card.appendChild(el("p", "master-bio", master.bio));
      }

      const names = (master.serviceIds || [])
        .map(function (id) {
          return serviceNameById.get(id);
        })
        .filter(Boolean);

      if (names.length) {
        const tags = el("div", "master-tags");
        names.forEach(function (name) {
          tags.appendChild(el("span", "tag", name));
        });
        card.appendChild(tags);
      }

      mastersList.appendChild(card);
    });
  }

  /* ---------- Студия (шапка/подвал) ---------- */

  function renderStudio(studio) {
    const footerNote = document.getElementById("footer-note");

    if (!studio) {
      footerNote.textContent = "Данные студии недоступны.";
      return;
    }

    const parts = [];
    if (studio.address) parts.push(studio.address);
    if (studio.phone) parts.push(studio.phone);
    if (studio.openingTime && studio.closingTime) {
      parts.push("Ежедневно " + studio.openingTime + "–" + studio.closingTime);
    }
    footerNote.textContent = parts.join(" · ");
  }

  /* ---------- Загрузка ---------- */

  async function loadStudio() {
    const footerNote = document.getElementById("footer-note");
    try {
      const data = await window.API.getStudio();
      renderStudio(data ? data.studio : null);
    } catch (error) {
      footerNote.textContent = "Не удалось загрузить данные студии: " + error.message;
    }
  }

  async function loadCatalog() {
    renderSkeletons();

    const results = await Promise.allSettled([
      window.API.getServices(),
      window.API.getMasters(),
    ]);

    const servicesResult = results[0];
    const mastersResult = results[1];

    if (servicesResult.status === "fulfilled") {
      renderServices(servicesResult.value.services);
    } else {
      showMessage(servicesList, "data-error", "Не удалось загрузить услуги: " +
        servicesResult.reason.message);
    }

    if (mastersResult.status === "fulfilled") {
      renderMasters(mastersResult.value.masters);
    } else {
      showMessage(mastersList, "data-error", "Не удалось загрузить мастеров: " +
        mastersResult.reason.message);
    }
  }

  /* ---------- Запуск ---------- */

  loadStudio();
  loadCatalog();
})();
