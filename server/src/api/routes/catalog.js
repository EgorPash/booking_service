"use strict";

const { getDb } = require("../../db/connection");
const { getStudio } = require("../availability");
const { masterServiceIds } = require("../sql");
const v = require("../validate");
const mappers = require("../mappers");

function register(router) {
  router.get("/api/services", async () => {
    const rows = getDb()
      .prepare(
        "SELECT id, name, description, duration_min, price_minor, currency, is_active FROM services WHERE is_active = 1 ORDER BY name"
      )
      .all();
    return { services: rows.map(mappers.service) };
  });

  router.get("/api/masters", async (ctx) => {
    const db = getDb();
    const serviceIdRaw = ctx.query.get("serviceId");

    let rows;
    if (serviceIdRaw) {
      const serviceId = v.int(serviceIdRaw, "serviceId", { min: 1 });
      rows = db
        .prepare(
          "SELECT m.id, m.full_name, m.title, m.bio, m.avatar_url, m.is_active FROM masters m " +
            "JOIN master_services ms ON ms.master_id = m.id " +
            "WHERE m.is_active = 1 AND ms.service_id = ? ORDER BY m.full_name"
        )
        .all(serviceId);
    } else {
      rows = db
        .prepare(
          "SELECT id, full_name, title, bio, avatar_url, is_active FROM masters WHERE is_active = 1 ORDER BY full_name"
        )
        .all();
    }

    const serviceMap = masterServiceIds(db, rows.map((row) => row.id));
    return { masters: rows.map((row) => mappers.master(row, serviceMap.get(row.id) || [])) };
  });

  router.get("/api/studio", async () => {
    const studio = getStudio();
    if (!studio) return { studio: null };
    return {
      studio: {
        id: studio.id,
        name: studio.name,
        address: studio.address,
        phone: studio.phone,
        timezone: studio.timezone,
        currency: studio.currency,
        openingTime: studio.opening_time,
        closingTime: studio.closing_time,
      },
    };
  });
}

module.exports = { register };
