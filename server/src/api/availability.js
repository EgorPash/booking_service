"use strict";

const config = require("../config");
const { getDb } = require("../db/connection");
const { badRequest, notFound } = require("./http");
const time = require("./time");

function getStudio() {
  return getDb()
    .prepare(
      "SELECT id, name, address, phone, timezone, currency, opening_time, closing_time FROM studios ORDER BY id LIMIT 1"
    )
    .get();
}

function studioTimezone() {
  const studio = getStudio();
  return (studio && studio.timezone) || config.timezone;
}

function getActiveMaster(masterId) {
  const row = getDb()
    .prepare("SELECT id, full_name, is_active FROM masters WHERE id = ?")
    .get(masterId);
  if (!row) throw notFound("Мастер не найден");
  if (row.is_active !== 1) throw notFound("Мастер недоступен");
  return row;
}

function assertServicesExist(serviceIds) {
  const db = getDb();
  const placeholders = serviceIds.map(() => "?").join(",");
  const rows = db
    .prepare("SELECT id FROM services WHERE id IN (" + placeholders + ")")
    .all(...serviceIds);
  if (rows.length !== serviceIds.length) throw badRequest("Одна или несколько услуг не найдены");
}

function resolveServices(serviceIds) {
  const db = getDb();
  const placeholders = serviceIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      "SELECT id, name, duration_min, price_minor, currency, is_active FROM services WHERE id IN (" +
        placeholders +
        ")"
    )
    .all(...serviceIds);
  if (rows.length !== serviceIds.length) throw badRequest("Одна или несколько услуг не найдены");

  const ordered = serviceIds.map((id) => rows.find((row) => row.id === id));
  for (const row of ordered) {
    if (row.is_active !== 1) throw badRequest('Услуга "' + row.name + '" недоступна');
  }

  return {
    services: ordered,
    durationMin: ordered.reduce((sum, row) => sum + row.duration_min, 0),
    priceMinor: ordered.reduce((sum, row) => sum + row.price_minor, 0),
    currency: ordered[0].currency,
  };
}

function assertMasterProvides(masterId, serviceIds) {
  const db = getDb();
  const placeholders = serviceIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      "SELECT service_id FROM master_services WHERE master_id = ? AND service_id IN (" +
        placeholders +
        ")"
    )
    .all(masterId, ...serviceIds);
  if (rows.length !== serviceIds.length) throw badRequest("Мастер не оказывает одну из выбранных услуг");
}

function mergeIntervals(list) {
  const sorted = list
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

function subtractIntervals(work, busy) {
  let result = work.map((interval) => ({ start: interval.start, end: interval.end }));
  for (const block of busy) {
    const next = [];
    for (const interval of result) {
      if (block.end <= interval.start || block.start >= interval.end) {
        next.push(interval);
        continue;
      }
      if (block.start > interval.start) next.push({ start: interval.start, end: block.start });
      if (block.end < interval.end) next.push({ start: block.end, end: interval.end });
    }
    result = next;
  }
  return result;
}

function busyIntervals({ masterId, dayStart, dayEnd, now, excludeBookingId, excludeHoldId }) {
  const db = getDb();
  const list = [];

  const blocks = db
    .prepare(
      "SELECT starts_at, ends_at FROM time_blocks WHERE master_id = ? AND ends_at > ? AND starts_at < ?"
    )
    .all(masterId, dayStart, dayEnd);
  for (const row of blocks) list.push({ start: row.starts_at, end: row.ends_at });

  const bookings = db
    .prepare(
      "SELECT id, starts_at, ends_at FROM bookings " +
        "WHERE master_id = ? AND status IN ('pending','confirmed') AND ends_at > ? AND starts_at < ?"
    )
    .all(masterId, dayStart, dayEnd);
  for (const row of bookings) {
    if (excludeBookingId && row.id === excludeBookingId) continue;
    list.push({ start: row.starts_at, end: row.ends_at });
  }

  const holds = db
    .prepare(
      "SELECT id, starts_at, ends_at FROM slot_holds " +
        "WHERE master_id = ? AND expires_at > ? AND ends_at > ? AND starts_at < ?"
    )
    .all(masterId, now, dayStart, dayEnd);
  for (const row of holds) {
    if (excludeHoldId && row.id === excludeHoldId) continue;
    list.push({ start: row.starts_at, end: row.ends_at });
  }

  return list;
}

function computeFreeIntervals({ masterId, date, timeZone, excludeBookingId, excludeHoldId }) {
  const db = getDb();
  const zone = timeZone || studioTimezone();
  const weekday = time.isoWeekday(date);

  const schedules = db
    .prepare(
      "SELECT start_time, end_time FROM master_schedules " +
        "WHERE master_id = ? AND weekday = ? " +
        "AND (valid_from IS NULL OR valid_from <= ?) " +
        "AND (valid_to IS NULL OR valid_to >= ?) " +
        "ORDER BY start_time"
    )
    .all(masterId, weekday, date, date);

  const work = schedules.map((row) => ({
    start: time.localToUtcIso(date, row.start_time, zone),
    end: time.localToUtcIso(date, row.end_time, zone),
  }));

  const dayStart = time.localToUtcIso(date, "00:00", zone);
  const dayEnd = time.addDaysIso(dayStart, 1);
  const now = time.nowIso();

  const busy = mergeIntervals(
    busyIntervals({ masterId, dayStart, dayEnd, now, excludeBookingId, excludeHoldId })
  );

  return subtractIntervals(mergeIntervals(work), busy);
}

function computeSlots({ masterId, date, durationMin, stepMin, timeZone, excludeBookingId, excludeHoldId }) {
  const zone = timeZone || studioTimezone();
  const step = stepMin || config.slotStepMinutes;
  const free = computeFreeIntervals({ masterId, date, timeZone: zone, excludeBookingId, excludeHoldId });
  const now = time.nowIso();

  const slots = [];
  for (const interval of free) {
    let cursor = interval.start;
    while (time.addMinutesIso(cursor, durationMin) <= interval.end) {
      if (cursor >= now) {
        slots.push({
          startsAt: cursor,
          endsAt: time.addMinutesIso(cursor, durationMin),
          time: time.utcToLocal(cursor, zone).time,
        });
      }
      cursor = time.addMinutesIso(cursor, step);
    }
  }
  return { timeZone: zone, slots };
}

function isIntervalFree({ masterId, date, startIso, endIso, timeZone, excludeBookingId, excludeHoldId }) {
  const free = computeFreeIntervals({ masterId, date, timeZone, excludeBookingId, excludeHoldId });
  return free.some((interval) => interval.start <= startIso && endIso <= interval.end);
}

function nearestFreeSlots({ masterId, durationMin, timeZone, fromIso, limit = 5, daysAhead = 14 }) {
  const zone = timeZone || studioTimezone();
  const from = fromIso || time.nowIso();
  const startDate = time.utcToLocal(from, zone).date;
  const found = [];

  for (let i = 0; i <= daysAhead && found.length < limit; i += 1) {
    const date = time.addDaysDate(startDate, i);
    const { slots } = computeSlots({
      masterId,
      date,
      durationMin,
      stepMin: config.slotStepMinutes,
      timeZone: zone,
    });
    for (const slot of slots) {
      if (slot.startsAt >= from && found.length < limit) {
        found.push({ date, startsAt: slot.startsAt, endsAt: slot.endsAt, time: slot.time });
      }
    }
  }
  return found;
}

module.exports = {
  getStudio,
  studioTimezone,
  getActiveMaster,
  assertServicesExist,
  resolveServices,
  assertMasterProvides,
  computeFreeIntervals,
  computeSlots,
  isIntervalFree,
  nearestFreeSlots,
};
