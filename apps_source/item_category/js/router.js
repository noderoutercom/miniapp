// js/router.js — hash-based screen router
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

export function navigate(name, state) {
  if (state) {
    sessionStorage.setItem("ic-nav-state", JSON.stringify(state));
  } else {
    sessionStorage.removeItem("ic-nav-state");
  }
  window.location.hash = name;
}

export function getNavState() {
  try {
    const raw = sessionStorage.getItem("ic-nav-state");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _route() {
  const name  = window.location.hash.slice(1) || "dashboard";
  const mount = _screens[name];
  if (!mount) return;
  _root.innerHTML = "";
  mount(_root);
}
