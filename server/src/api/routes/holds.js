"use strict";

const { notFound, conflict, forbidden } = require("../http");
const { requireAuth, hasRole } = require("../session");
const {
  getActiveMaster,
  resolveServices,
  assertMasterProvides,
  isIntervalFree,
  studioTimezone,
  studioHoldTtl,
} = require("../availability");
const holds = require("../holds");
const time = require("../time");
const v = require("../validate");

function assertOwnership(user, hold) {
  if (hasRole(user, "admin")) return;
  if (hold.userId !== user.id) throw forbidden("Нет доступа к этому удержанию");
}

function register(router) {
  router.post("/api/holds", async (ctx) => {
    const user = requireAuth(ctx);
    holds.cleanupExpiredHolds();

    const body = ctx.body || {};
    const masterId = v.int(body.masterId, "masterId", { min: 1 });
    const serviceIds = v.idList(body.serviceIds);
    const startsAt = v.isoUtc(body.startsAt, "startsAt");

    getActiveMaster(masterId);
    const selection = resolveServices(serviceIds);
    assertMasterProvides(masterId, serviceIds);

    const endsAt = time.addMinutesIso(startsAt, selection.durationMin);
    const date = time.utcToLocal(startsAt, studioTimezone()).date;

    if (!isIntervalFree({ masterId, date, startIso: startsAt, endIso: endsAt })) {
      throw conflict("Выбранное время недоступно");
    }

    const hold = holds.createHold({
      masterId,
      serviceIds,
      startsAt,
      endsAt,
      durationMin: selection.durationMin,
      priceMinor: selection.priceMinor,
      currency: selection.currency,
      userId: user.id,
    });

    ctx.status = 201;
    return {
      holdId: hold.id,
      masterId,
      serviceIds,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      durationMin: hold.durationMin,
      priceMinor: hold.priceMinor,
      currency: hold.currency,
      expiresAt: hold.expiresAt,
      ttlSeconds: studioHoldTtl() * 60,
    };
  });

  router.get("/api/holds/:id", async (ctx) => {
    const user = requireAuth(ctx);
    const hold = holds.getHold(ctx.params.id);
    if (!hold) throw notFound("Удержание не найдено или истекло");
    assertOwnership(user, hold);
    return {
      holdId: hold.id,
      masterId: hold.masterId,
      serviceIds: hold.serviceIds,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
      expiresAt: hold.expiresAt,
      active: true,
    };
  });

  router.delete("/api/holds/:id", async (ctx) => {
    const user = requireAuth(ctx);
    const hold = holds.getHold(ctx.params.id);
    if (!hold) throw notFound("Удержание не найдено");
    assertOwnership(user, hold);
    holds.releaseHold(ctx.params.id);
    return { holdId: ctx.params.id, released: true };
  });
}

module.exports = { register };
