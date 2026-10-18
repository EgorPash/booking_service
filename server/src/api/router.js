"use strict";

class Router {
  constructor() {
    this.routes = [];
  }

  add(method, path, handler) {
    const pattern = path.split("/").filter(Boolean);
    this.routes.push({ method, pattern, handler, path });
    return this;
  }

  get(path, handler) {
    return this.add("GET", path, handler);
  }

  post(path, handler) {
    return this.add("POST", path, handler);
  }

  put(path, handler) {
    return this.add("PUT", path, handler);
  }

  patch(path, handler) {
    return this.add("PATCH", path, handler);
  }

  delete(path, handler) {
    return this.add("DELETE", path, handler);
  }

  match(method, pathname) {
    const segments = pathname.split("/").filter(Boolean);

    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.pattern.length !== segments.length) continue;

      const params = {};
      let matched = true;
      for (let i = 0; i < segments.length; i += 1) {
        const token = route.pattern[i];
        if (token.startsWith(":")) {
          params[token.slice(1)] = decodeURIComponent(segments[i]);
        } else if (token !== segments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params, route };
    }
    return null;
  }
}

module.exports = { Router };
