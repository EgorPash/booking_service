"use strict";

const crypto = require("node:crypto");
const { getDb } = require("../db/connection");
const { studioHoldTtl } = require("./availability");
const time = require("./time");

function normalize(row) {
  let serviceIds = [];
  try {
    serviceIds = JSON.parse(row.service_ids);
  } catch (error) {
    serviceIds = [];
  }
  if (!Array.isArray(serviceIds)) serviceIds = [];
  return {
    id: row.id,
    userId: row.user_id,
    masterId: row.master_id,
    serviceIds,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    durationMin: row.duration_min,
    priceMinor: row.price_minor,
    currency: row.currency,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function cleanupExpiredHolds() {
  return getDb().prepare("DELETE FROM slot_holds WHERE expires_at <= ?").run(time.nowIso()).changes;
}

function getHold(id) {
  const row = getDb().prepare("SELECT * FROM slot_holds WHERE id = ?").get(id);
  if (!row) return null;
  if (row.expires_at <= time.nowIso()) {
    getDb().prepare("DELETE FROM slot_holds WHERE id = ?").run(id);
    return null;
  }
  return normalize(row);
}

function createHold({ masterId, serviceIds, startsAt, endsAt, durationMin, priceMinor, currency, userId }) {
  const id = crypto.randomUUID();
  const expiresAt = time.addMinutesIso(time.nowIso(), studioHoldTtl());
  getDb()
    .prepare(
      "INSERT INTO slot_holds (id, master_id, service_ids, starts_at, ends_at, duration_min, price_minor, currency, expires_at, user_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      id,
      masterId,
      JSON.stringify(serviceIds),
      startsAt,
      endsAt,
      durationMin,
      priceMinor,
      currency,
      expiresAt,
      userId ?? null
    );
  return getHold(id);
}

function releaseHold(id) {
  return getDb().prepare("DELETE FROM slot_holds WHERE id = ?").run(id).changes;
}

module.exports = { cleanupExpiredHolds, getHold, createHold, releaseHold, normalize };
