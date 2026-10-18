"use strict";

const { getDb } = require("../../db/connection");
const { requireAuth, hasRole } = require("../session");
const {
  createBookings,
  getBookingDetail,
  rescheduleBooking,
  cancelBooking,
} = require("../booking-service");
const { bookingSelect } = require("../sql");
const { studioTimezone } = require("../availability");
const v = require("../validate");
const mappers = require("../mappers");

function register(router) {
  router.post("/api/bookings", async (ctx) => {
    const user = requireAuth(ctx);
    const result = createBookings(user, ctx.body || {});
    ctx.status = 201;
    return result;
  });

  router.get("/api/bookings/my", async (ctx) => {
    const user = requireAuth(ctx);
    const db = getDb();
    const timeZone = studioTimezone();

    let rows;
    if (hasRole(user, "admin")) {
      rows = db.prepare(bookingSelect("") + "ORDER BY b.starts_at DESC").all();
    } else if (hasRole(user, "master")) {
      const master = db.prepare("SELECT id FROM masters WHERE user_id = ?").get(user.id);
      if (!master) return { bookings: [] };
      rows = db
        .prepare(bookingSelect("WHERE b.master_id = ?") + "ORDER BY b.starts_at DESC")
        .all(master.id);
    } else {
      const client = db.prepare("SELECT id FROM clients WHERE email = ?").get(user.email);
      if (!client) return { bookings: [] };
      rows = db
        .prepare(bookingSelect("WHERE b.client_id = ?") + "ORDER BY b.starts_at DESC")
        .all(client.id);
    }

    return { bookings: rows.map((row) => mappers.bookingDetail(row, timeZone)) };
  });

  router.get("/api/bookings/:id", async (ctx) => {
    const user = requireAuth(ctx);
    const id = v.int(ctx.params.id, "id", { min: 1 });
    return { booking: getBookingDetail(user, id) };
  });

  router.patch("/api/bookings/:id", async (ctx) => {
    const user = requireAuth(ctx);
    const id = v.int(ctx.params.id, "id", { min: 1 });
    return { booking: rescheduleBooking(user, id, ctx.body || {}) };
  });

  router.post("/api/bookings/:id/cancel", async (ctx) => {
    const user = requireAuth(ctx);
    const id = v.int(ctx.params.id, "id", { min: 1 });
    return { booking: cancelBooking(user, id) };
  });
}

module.exports = { register };
