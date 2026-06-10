// lib/router.js — simple hash-based screen router
const _screens = {};
let _root = null;

export function register(name, mountFn) {
  _screens[name] = mountFn;
}

export function start(rootEl) {
  _root = rootEl;
  window.addEventListener("hashchange", _route);
  _route();
}

export function navigate(name) {
  window.location.hash = name;
}

function _route() {
  const name = (window.location.hash.slice(1) || "dashboard");
  const mount = _screens[name];
  if (!mount) return;
  _root.innerHTML = "";
  mount(_root);
}
