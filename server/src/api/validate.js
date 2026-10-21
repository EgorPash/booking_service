"use strict";

const { badRequest } = require("./http");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PHONE_RE = /^\+?\d{10,15}$/;

function string(value, name, options = {}) {
  const { min = 1, max = 500, trim = true } = options;
  if (typeof value !== "string") throw badRequest('Поле "' + name + '" обязательно и должно быть строкой');
  const result = trim ? value.trim() : value;
  if (result.length < min) throw badRequest('Поле "' + name + '" короче допустимого (' + min + ')');
  if (result.length > max) throw badRequest('Поле "' + name + '" длиннее допустимого (' + max + ')');
  return result;
}

function optionalString(value, name, options = {}) {
  const { max = 2000 } = options;
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw badRequest('Поле "' + name + '" должно быть строкой');
  const result = value.trim();
  if (result === "") return null;
  if (result.length > max) throw badRequest('Поле "' + name + '" длиннее допустимого (' + max + ')');
  return result;
}

function email(value, name = "email") {
  const result = string(value, name, { max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(result)) throw badRequest('Поле "' + name + '" не похоже на email');
  return result;
}

function password(value, name = "password") {
  const result = string(value, name, { min: 8, max: 200, trim: false });
  return result;
}

function phone(value, name = "phone") {
  const raw = string(value, name, { max: 30 });
  const normalized = raw.replace(/[\s\-()]/g, "");
  if (!PHONE_RE.test(normalized)) throw badRequest('Поле "' + name + '" не похоже на телефон');
  return normalized.startsWith("+") ? normalized : "+" + normalized;
}

function int(value, name, options = {}) {
  const { min, max } = options;
  if (value === undefined || value === null || value === "") {
    throw badRequest('Поле "' + name + '" обязательно и должно быть целым числом');
  }
  const num = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(num)) throw badRequest('Поле "' + name + '" должно быть целым числом');
  if (min !== undefined && num < min) throw badRequest('Поле "' + name + '" меньше допустимого (' + min + ')');
  if (max !== undefined && num > max) throw badRequest('Поле "' + name + '" больше допустимого (' + max + ')');
  return num;
}

function bool(value, name) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === 0) return value === 1;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw badRequest('Поле "' + name + '" должно быть логическим (true/false)');
}

function enumValue(value, name, allowed) {
  const result = string(value, name, { max: 40 });
  if (!allowed.includes(result)) {
    throw badRequest('Поле "' + name + '" должно быть одним из: ' + allowed.join(", "));
  }
  return result;
}

function isoUtc(value, name) {
  const result = string(value, name, { max: 30 });
  if (!ISO_UTC_RE.test(result) || Number.isNaN(new Date(result).getTime())) {
    throw badRequest('Поле "' + name + '" должно быть моментом в формате ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ)');
  }
  return result;
}

function dateOnly(value, name = "date") {
  const result = string(value, name, { max: 10 });
  if (!DATE_RE.test(result) || Number.isNaN(new Date(result + "T00:00:00Z").getTime())) {
    throw badRequest('Поле "' + name + '" должно быть датой в формате YYYY-MM-DD');
  }
  return result;
}

function timeHHMM(value, name) {
  const result = string(value, name, { max: 5 });
  if (!TIME_RE.test(result)) throw badRequest('Поле "' + name + '" должно быть временем в формате HH:MM');
  return result;
}

function idList(value, name = "serviceIds") {
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") items = value.split(",");
  else throw badRequest('Поле "' + name + '" должно быть массивом идентификаторов');

  const ids = [];
  for (const item of items) {
    if (item === "" || item === null || item === undefined) continue;
    const num = Number(String(item).trim());
    if (!Number.isInteger(num) || num <= 0) {
      throw badRequest('Поле "' + name + '" содержит некорректный идентификатор');
    }
    if (!ids.includes(num)) ids.push(num);
  }
  if (ids.length === 0) throw badRequest('Поле "' + name + '" не может быть пустым');
  if (ids.length > 10) throw badRequest('За одну запись допустимо не более 10 услуг');
  return ids;
}

function ids(value, name, options = {}) {
  const { max = 10, allowEmpty = false } = options;
  let items;
  if (Array.isArray(value)) items = value;
  else if (typeof value === "string") items = value.split(",");
  else throw badRequest('Поле "' + name + '" должно быть массивом идентификаторов');

  const result = [];
  for (const item of items) {
    if (item === "" || item === null || item === undefined) continue;
    const num = Number(String(item).trim());
    if (!Number.isInteger(num) || num <= 0) {
      throw badRequest('Поле "' + name + '" содержит некорректный идентификатор');
    }
    if (!result.includes(num)) result.push(num);
  }
  // Пустой список допустим там, где отметки можно снять целиком
  // (например, «услуги мастера» в админ-разделе).
  if (result.length === 0 && !allowEmpty) {
    throw badRequest('Поле "' + name + '" не может быть пустым');
  }
  if (result.length > max) throw badRequest('Слишком много элементов в "' + name + '"');
  return result;
}

module.exports = {
  string,
  optionalString,
  email,
  password,
  phone,
  int,
  bool,
  enumValue,
  isoUtc,
  dateOnly,
  timeHHMM,
  idList,
  ids,
};
