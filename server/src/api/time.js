"use strict";

const MS_PER_MINUTE = 60 * 1000;

function toIsoUtc(date) {
  const ms = Math.floor(date.getTime() / 1000) * 1000;
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function nowIso() {
  return toIsoUtc(new Date());
}

function addMinutesIso(iso, minutes) {
  return toIsoUtc(new Date(new Date(iso).getTime() + minutes * MS_PER_MINUTE));
}

function addDaysIso(iso, days) {
  return toIsoUtc(new Date(new Date(iso).getTime() + days * 24 * 60 * MS_PER_MINUTE));
}

function diffMinutesIso(startIso, endIso) {
  return Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / MS_PER_MINUTE
  );
}

function tzOffsetMs(timeZone, date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

function localToUtcIso(dateStr, timeHHMM, timeZone) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const [hours, minutes] = timeHHMM.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hours, minutes, 0);
  let offset = tzOffsetMs(timeZone, new Date(guess));
  let utc = guess - offset;
  offset = tzOffsetMs(timeZone, new Date(utc));
  utc = guess - offset;
  return toIsoUtc(new Date(utc));
}

function utcToLocal(iso, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = {};
  for (const part of formatter.formatToParts(new Date(iso))) parts[part.type] = part.value;
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    time: parts.hour + ":" + parts.minute,
  };
}

function addDaysDate(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 24 * 60 * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 10);
}

function isoWeekday(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

module.exports = {
  MS_PER_MINUTE,
  toIsoUtc,
  nowIso,
  addMinutesIso,
  addDaysIso,
  diffMinutesIso,
  tzOffsetMs,
  localToUtcIso,
  utcToLocal,
  addDaysDate,
  isoWeekday,
  intervalsOverlap,
};
