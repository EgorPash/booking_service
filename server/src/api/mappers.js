"use strict";

const { utcToLocal, diffMinutesIso } = require("./time");

function service(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    durationMin: row.duration_min,
    priceMinor: row.price_minor,
    currency: row.currency,
    isActive: row.is_active === 1,
  };
}

function master(row, serviceIds) {
  return {
    id: row.id,
    fullName: row.full_name,
    title: row.title ?? null,
    bio: row.bio ?? null,
    avatarUrl: row.avatar_url ?? null,
    isActive: row.is_active === 1,
    serviceIds: serviceIds || [],
  };
}

function client(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email ?? null,
  };
}

function booking(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    masterId: row.master_id,
    serviceId: row.service_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    durationMin: row.duration_min,
    priceMinor: row.price_minor,
    currency: row.currency,
    comment: row.comment ?? null,
    allowOverlap: row.allow_overlap === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function bookingDetail(row, timeZone) {
  // Снимок услуги: длительность и цена фиксируются в момент записи,
  // поэтому правка справочника не меняет уже оформленные записи.
  const durationMin =
    row.duration_min ?? row.service_duration_min ?? diffMinutesIso(row.starts_at, row.ends_at);

  return {
    id: row.id,
    status: row.status,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startsAtLocal: utcToLocal(row.starts_at, timeZone),
    endsAtLocal: utcToLocal(row.ends_at, timeZone),
    durationMin: diffMinutesIso(row.starts_at, row.ends_at),
    priceMinor: row.price_minor,
    currency: row.currency,
    comment: row.comment ?? null,
    allowOverlap: row.allow_overlap === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    client: { id: row.client_id, fullName: row.client_full_name, phone: row.client_phone },
    master: { id: row.master_id, fullName: row.master_full_name },
    service: {
      id: row.service_id,
      name: row.service_name,
      durationMin,
    },
  };
}

module.exports = { service, master, client, booking, bookingDetail };
