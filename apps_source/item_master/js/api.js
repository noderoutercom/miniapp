// js/api.js — sync wrapper for item_master
const APP = "item_master";

export async function sync(action, params) {
  const res = await fetch("/api/sync/" + APP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params: params || {} }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
  return data;
}
