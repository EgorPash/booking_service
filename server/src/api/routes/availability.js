"use strict";

const {
  getActiveMaster,
  resolveServices,
  assertMasterProvides,
  computeSlots,
} = require("../availability");
const v = require("../validate");

function register(router) {
  router.get("/api/masters/:id/slots", async (ctx) => {
    const masterId = v.int(ctx.params.id, "masterId", { min: 1 });
    const date = v.dateOnly(ctx.query.get("date"));
    const serviceIds = v.idList(ctx.query.get("serviceIds") || ctx.query.get("serviceId"));

    getActiveMaster(masterId);
    const selection = resolveServices(serviceIds);
    assertMasterProvides(masterId, serviceIds);

    const { timeZone, slots } = computeSlots({
      masterId,
      date,
      durationMin: selection.durationMin,
    });

    return {
      masterId,
      date,
      timezone: timeZone,
      durationMin: selection.durationMin,
      priceMinor: selection.priceMinor,
      currency: selection.currency,
      services: selection.services.map((row) => ({
        id: row.id,
        name: row.name,
        durationMin: row.duration_min,
      })),
      slots,
    };
  });
}

module.exports = { register };
