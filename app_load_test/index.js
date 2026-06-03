(function () {
  "use strict";

  var root = document.querySelector(".nr-app") || document.body;

  // ── Utilities ──────────────────────────────────────────────────────────────

  function el(id) { return root.querySelector("#" + id); }

  function esc(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function hms() {
    return new Date().toLocaleTimeString("default", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  async function syncCall(action, payload) {
    var res = await fetch("/api/sync/app_load_test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
    });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch (_) { throw new Error(text); }
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  async function asyncCall(action, payload) {
    var res = await fetch("/api/async/app_load_test", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {})),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  // ── Random record generator ────────────────────────────────────────────────

  var FIRST  = ["Alice","Bob","Carol","David","Eve","Frank","Grace","Henry","Iris","Jack","Kate","Leo","Mia","Noah","Olivia"];
  var LAST   = ["Smith","Jones","Williams","Brown","Davis","Miller","Wilson","Moore","Taylor","Anderson"];
  var DOMAIN = ["gmail.com","yahoo.com","outlook.com","corp.io","dev.net"];

  function randomRecord() {
    var fn = FIRST[Math.floor(Math.random() * FIRST.length)];
    var ln = LAST[Math.floor(Math.random() * LAST.length)];
    return {
      first_name: fn, last_name: ln,
      email: fn.toLowerCase() + "." + ln.toLowerCase() + Math.floor(Math.random() * 9999) + "@" + DOMAIN[Math.floor(Math.random() * DOMAIN.length)],
      age: 18 + Math.floor(Math.random() * 50),
      score: Math.round(Math.random() * 10000) / 100,
      notes: "lt-" + Date.now().toString(36),
    };
  }

  // ── Sync state ─────────────────────────────────────────────────────────────

  var syncRunning  = false;
  var syncRps      = 10;
  var syncTimer    = null;
  var syncSent     = 0;
  var syncOk       = 0;
  var syncFail     = 0;
  var syncInflight = 0;
  var syncStartTs  = 0;
  var syncLatBuf   = [];
  var MAX_INFLIGHT = 400;
  var MAX_LAT_BUF  = 300;

  function startSync() {
    syncRunning = true;
    syncSent = syncOk = syncFail = syncInflight = 0;
    syncLatBuf = []; syncStartTs = Date.now();
    setSyncBadge(true);
    var TICK = 50;
    var perTick = Math.max(1, Math.round(syncRps / (1000 / TICK)));
    syncTimer = setInterval(function () {
      for (var i = 0; i < perTick; i++) { if (!syncRunning) break; fireSyncReq(); }
    }, TICK);
  }

  function stopSync() {
    syncRunning = false;
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    setSyncBadge(false);
  }

  function setSyncBadge(on) {
    el("lt-sync-badge").textContent = on ? "Running" : "Stopped";
    el("lt-sync-badge").className   = on ? "badge bg-success" : "badge bg-secondary";
    el("lt-sync-toggle").innerHTML  = on ? '<i data-lucide="square" class="lt-icon-sm"></i> Stop' : '<i data-lucide="play" class="lt-icon-sm"></i> Start';
    el("lt-sync-toggle").className  = on ? "btn btn-sm btn-danger" : "btn btn-sm btn-success";
    lucide.createIcons();
  }

  function fireSyncReq() {
    if (syncInflight >= MAX_INFLIGHT) return;
    syncInflight++; syncSent++;
    var t0 = performance.now();
    syncCall("sync_insert", randomRecord()).then(function () {
      syncOk++; syncInflight--;
      var rtt = Math.round(performance.now() - t0);
      syncLatBuf.push(rtt);
      if (syncLatBuf.length > MAX_LAT_BUF) syncLatBuf.shift();
      addSyncPoint(rtt);
    }).catch(function () { syncFail++; syncInflight--; });
  }

  function avgLat() {
    if (!syncLatBuf.length) return 0;
    var s = 0; for (var i = 0; i < syncLatBuf.length; i++) s += syncLatBuf[i];
    return Math.round(s / syncLatBuf.length);
  }

  function actualRps() {
    if (!syncStartTs || !syncSent) return "0";
    var e = (Date.now() - syncStartTs) / 1000;
    return e > 0 ? (syncSent / e).toFixed(1) : "0";
  }

  // ── Async state ────────────────────────────────────────────────────────────

  var asyncRunning   = false;
  var asyncRate      = 1;
  var asyncIntensity = 1;
  var asyncTimer     = null;
  var asyncSubmitted = 0;
  var asyncDone      = 0;
  var asyncFail      = 0;
  var asyncPending   = 0;
  var asyncPolling   = 0;
  var MAX_POLL       = 30;

  function startAsync() {
    asyncRunning = true;
    asyncSubmitted = asyncDone = asyncFail = asyncPending = asyncPolling = 0;
    setAsyncBadge(true);
    var TICK = 200;
    var perTick = Math.max(1, Math.round(asyncRate / (1000 / TICK)));
    asyncTimer = setInterval(function () {
      for (var i = 0; i < perTick; i++) { if (!asyncRunning) break; submitJob(); }
    }, TICK);
  }

  function stopAsync() {
    asyncRunning = false;
    if (asyncTimer) { clearInterval(asyncTimer); asyncTimer = null; }
    setAsyncBadge(false);
  }

  function setAsyncBadge(on) {
    el("lt-async-badge").textContent = on ? "Running" : "Stopped";
    el("lt-async-badge").className   = on ? "badge bg-info" : "badge bg-secondary";
    el("lt-async-toggle").innerHTML  = on ? '<i data-lucide="square" class="lt-icon-sm"></i> Stop' : '<i data-lucide="play" class="lt-icon-sm"></i> Start';
    el("lt-async-toggle").className  = on ? "btn btn-sm btn-danger" : "btn btn-sm btn-info text-white";
    lucide.createIcons();
  }

  function submitJob() {
    asyncSubmitted++;
    asyncCall("async_compute", { intensity: asyncIntensity }).then(function (res) {
      asyncPending++;
      if (asyncPolling < MAX_POLL) { asyncPolling++; pollJob(res.job_id); }
    }).catch(function () { asyncFail++; });
  }

  function pollJob(jobId) {
    fetch("/api/async/jobs/" + jobId).then(function (r) { return r.json(); })
      .then(function (job) {
        if (job.status === "completed") {
          asyncDone++; asyncPending = Math.max(0, asyncPending - 1); asyncPolling = Math.max(0, asyncPolling - 1);
        } else if (job.status === "failed") {
          asyncFail++; asyncPending = Math.max(0, asyncPending - 1); asyncPolling = Math.max(0, asyncPolling - 1);
        } else {
          setTimeout(function () { pollJob(jobId); }, 2000);
        }
      }).catch(function () { setTimeout(function () { pollJob(jobId); }, 3000); });
  }

  // ── 500 ms ticker: update stats labels ────────────────────────────────────

  setInterval(function () {
    el("lt-s-sent").textContent     = syncSent;
    el("lt-s-ok").textContent       = syncOk;
    el("lt-s-fail").textContent     = syncFail;
    el("lt-s-rps").textContent      = actualRps();
    el("lt-s-lat").textContent      = syncLatBuf.length ? avgLat() + "ms" : "—";
    el("lt-s-inflight").textContent = syncInflight;

    el("lt-a-sub").textContent  = asyncSubmitted;
    el("lt-a-done").textContent = asyncDone;
    el("lt-a-pend").textContent = asyncPending;

    flushSyncBucket();
    flushAsyncBucket();
    renderSyncChart();
    renderAsyncChart();
  }, 500);

  // ── Chart 1: Sync latency + RPS ────────────────────────────────────────────

  var syncChart   = echarts.init(root.querySelector("#lt-chart-sync"), null, { renderer: "canvas" });
  var CHART_WIN   = 60;
  var syncBuckets = [];
  var syncBktSec  = 0;
  var syncBkt     = null;

  function addSyncPoint(ms) {
    var sec = Math.floor(Date.now() / 1000);
    if (sec !== syncBktSec) {
      if (syncBkt && syncBkt.cnt) {
        syncBuckets.push({ time: hms(), lat: Math.round(syncBkt.sum / syncBkt.cnt), rps: syncBkt.cnt });
        if (syncBuckets.length > CHART_WIN) syncBuckets.shift();
      }
      syncBktSec = sec; syncBkt = { sum: 0, cnt: 0 };
    }
    syncBkt.sum += ms; syncBkt.cnt++;
  }

  function flushSyncBucket() {
    if (!syncBkt || !syncBkt.cnt) return;
    if (Math.floor(Date.now() / 1000) !== syncBktSec) addSyncPoint(0);
  }

  function renderSyncChart() {
    if (!syncBuckets.length) return;
    var times = syncBuckets.map(function (b) { return b.time; });
    syncChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", textStyle: { fontSize: 11 } },
      legend:  { data: ["Latency ms", "RPS"], top: 2, textStyle: { fontSize: 10 } },
      grid:    { top: 32, bottom: 22, left: 46, right: 46 },
      xAxis:   [{ type: "category", data: times, axisLabel: { fontSize: 9 }, boundaryGap: false }],
      yAxis:   [
        { type: "value", name: "ms",  position: "left",  min: 0, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
        { type: "value", name: "RPS", position: "right", min: 0, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
      ],
      series: [
        { name: "Latency ms", type: "line", yAxisIndex: 0, data: syncBuckets.map(function (b) { return b.lat; }),
          smooth: true, symbol: "none", lineStyle: { color: "#0d6efd", width: 2 }, areaStyle: { color: "rgba(13,110,253,0.07)" } },
        { name: "RPS", type: "bar", yAxisIndex: 1, data: syncBuckets.map(function (b) { return b.rps; }),
          itemStyle: { color: "rgba(25,135,84,0.50)" }, barMaxWidth: 12 },
      ],
    }, true);
  }

  // ── Chart 2: Async queue + throughput ──────────────────────────────────────

  var asyncChart   = echarts.init(root.querySelector("#lt-chart-async"), null, { renderer: "canvas" });
  var asyncBuckets = [];
  var asyncBktSec  = Math.floor(Date.now() / 1000);
  var asyncPrevSnap = { submitted: 0, done: 0 };

  function flushAsyncBucket() {
    var sec = Math.floor(Date.now() / 1000);
    if (sec === asyncBktSec) return;
    var ds = asyncSubmitted - asyncPrevSnap.submitted;
    var dd = asyncDone - asyncPrevSnap.done;
    asyncPrevSnap = { submitted: asyncSubmitted, done: asyncDone };
    asyncBktSec   = sec;
    if (ds || dd || asyncPending || asyncBuckets.length) {
      asyncBuckets.push({ time: hms(), submit: ds, done: dd, pending: asyncPending });
      if (asyncBuckets.length > CHART_WIN) asyncBuckets.shift();
    }
  }

  function renderAsyncChart() {
    if (!asyncBuckets.length) return;
    var times = asyncBuckets.map(function (b) { return b.time; });
    asyncChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", textStyle: { fontSize: 11 } },
      legend:  { data: ["Pending", "Submit/s", "Done/s"], top: 2, textStyle: { fontSize: 10 } },
      grid:    { top: 32, bottom: 22, left: 46, right: 46 },
      xAxis:   [{ type: "category", data: times, axisLabel: { fontSize: 9 }, boundaryGap: true }],
      yAxis:   [
        { type: "value", name: "jobs", position: "left",  min: 0, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
        { type: "value", name: "/s",   position: "right", min: 0, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } },
      ],
      series: [
        { name: "Pending",  type: "line", yAxisIndex: 0, data: asyncBuckets.map(function (b) { return b.pending; }),
          smooth: true, symbol: "none", lineStyle: { color: "#ffc107", width: 2 }, areaStyle: { color: "rgba(255,193,7,0.08)" } },
        { name: "Submit/s", type: "bar",  yAxisIndex: 1, data: asyncBuckets.map(function (b) { return b.submit; }),
          itemStyle: { color: "rgba(13,202,240,0.65)" }, barMaxWidth: 10, stack: "rate" },
        { name: "Done/s",   type: "bar",  yAxisIndex: 1, data: asyncBuckets.map(function (b) { return b.done; }),
          itemStyle: { color: "rgba(25,135,84,0.65)" }, barMaxWidth: 10, stack: "rate" },
      ],
    }, true);
  }

  // ── Chart 3 & 4: System stats (CPU + Memory) ───────────────────────────────

  var cpuChart = echarts.init(root.querySelector("#lt-chart-cpu"), null, { renderer: "canvas" });
  var memChart = echarts.init(root.querySelector("#lt-chart-mem"), null, { renderer: "canvas" });

  var COLORS       = ["#0d6efd","#198754","#dc3545","#ffc107","#0dcaf0","#6f42c1","#fd7e14","#20c997"];
  var sysLabels    = [];
  var cpuSeries    = {};  // {name: [values]}
  var memSeries    = {};  // {name: [values]}

  function pollSysStats() {
    syncCall("get_system_stats").then(function (res) {
      var ctrs = res.containers || [];
      var t    = hms();

      sysLabels.push(t);
      if (sysLabels.length > CHART_WIN) sysLabels.shift();

      ctrs.forEach(function (c) {
        if (!cpuSeries[c.name]) cpuSeries[c.name] = [];
        if (!memSeries[c.name]) memSeries[c.name] = [];
        cpuSeries[c.name].push(c.cpu_pct);
        memSeries[c.name].push(c.mem_mb);
        if (cpuSeries[c.name].length > CHART_WIN) cpuSeries[c.name].shift();
        if (memSeries[c.name].length > CHART_WIN) memSeries[c.name].shift();
      });

      var srcLabel = res.source === "docker" ? "docker" : res.source === "psutil" ? "psutil" : "";
      if (el("lt-cpu-source")) el("lt-cpu-source").textContent = srcLabel;
      if (el("lt-mem-source")) el("lt-mem-source").textContent = srcLabel;

      renderCpuChart();
      renderMemChart();
    }).catch(function () {});
  }

  function makeSeries(map, colorOffset) {
    return Object.keys(map).map(function (name, i) {
      var color = COLORS[(colorOffset + i) % COLORS.length];
      return {
        name:      name,
        type:      "line",
        data:      map[name],
        smooth:    true,
        symbol:    "none",
        lineStyle: { color: color, width: 1.5 },
        areaStyle: { color: color, opacity: 0.05 },
      };
    });
  }

  var PLACEHOLDER_OPT = {
    backgroundColor: "transparent",
    graphic: [{ type: "text", left: "center", top: "middle",
      style: { text: "Waiting for data…", fill: "#6c757d", fontSize: 12 } }],
  };

  function renderCpuChart() {
    var names = Object.keys(cpuSeries);
    if (!names.length || !sysLabels.length) { cpuChart.setOption(PLACEHOLDER_OPT, true); return; }
    cpuChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", textStyle: { fontSize: 11 } },
      legend:  { data: names, top: 2, textStyle: { fontSize: 10 } },
      grid:    { top: 32, bottom: 22, left: 46, right: 16 },
      xAxis:   [{ type: "category", data: sysLabels, axisLabel: { fontSize: 9 }, boundaryGap: false }],
      yAxis:   [{ type: "value", name: "CPU%", min: 0, max: 100, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9, formatter: "{value}%" } }],
      series:  makeSeries(cpuSeries, 0),
    }, true);
  }

  function renderMemChart() {
    var names = Object.keys(memSeries);
    if (!names.length || !sysLabels.length) { memChart.setOption(PLACEHOLDER_OPT, true); return; }
    memChart.setOption({
      backgroundColor: "transparent",
      tooltip: { trigger: "axis", textStyle: { fontSize: 11 } },
      legend:  { data: names, top: 2, textStyle: { fontSize: 10 } },
      grid:    { top: 32, bottom: 22, left: 52, right: 16 },
      xAxis:   [{ type: "category", data: sysLabels, axisLabel: { fontSize: 9 }, boundaryGap: false }],
      yAxis:   [{ type: "value", name: "MB", min: 0, nameTextStyle: { fontSize: 9 }, axisLabel: { fontSize: 9 } }],
      series:  makeSeries(memSeries, 2),
    }, true);
  }

  cpuChart.setOption(PLACEHOLDER_OPT, true);
  memChart.setOption(PLACEHOLDER_OPT, true);

  setInterval(pollSysStats, 2000);
  pollSysStats();

  window.addEventListener("resize", function () {
    syncChart.resize(); asyncChart.resize(); cpuChart.resize(); memChart.resize();
  });

  // ── History table ──────────────────────────────────────────────────────────

  function renderHistory(rows) {
    var tbody = el("lt-history-tbody");
    if (!tbody) return;
    el("lt-history-count").textContent = rows.length + " rows";
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3 small">No records yet</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (r) {
      var tb = r.req_type === "sync"
        ? '<span class="badge bg-primary">sync</span>'
        : '<span class="badge bg-info text-white">async</span>';
      var sb = r.status === "ok"
        ? '<span class="badge bg-success">ok</span>'
        : '<span class="badge bg-danger">error</span>';
      var lc = r.latency_ms == null ? "" : r.latency_ms < 50 ? "text-success fw-semibold" : r.latency_ms < 200 ? "text-warning fw-semibold" : "text-danger fw-semibold";
      return "<tr><td class='text-muted small'>" + r.id + "</td><td>" + tb + "</td><td>" + sb
        + "</td><td class='" + lc + "'>" + (r.latency_ms != null ? r.latency_ms : "—")
        + "</td><td class='text-muted small'>" + esc(r.error_msg || "")
        + "</td><td class='text-muted small'>" + (r.created_at ? dayjs(r.created_at).format("HH:mm:ss.SSS") : "—") + "</td></tr>";
    }).join("");
  }

  function loadHistory(t) {
    syncCall("get_history", { limit: 200, req_type: t || "" }).then(function (r) { renderHistory(r.rows); }).catch(function () {});
  }

  setInterval(function () { var f = el("lt-filter-type"); loadHistory(f ? f.value : ""); }, 5000);
  loadHistory("");

  // ── Event delegation ───────────────────────────────────────────────────────

  root.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action],[data-rps],[data-rate],[data-intensity]");
    if (!t) return;

    if (t.dataset.rps) {
      root.querySelectorAll("#lt-sync-rps-group .lt-sel-btn").forEach(function (b) { b.classList.remove("lt-sel-active"); });
      t.classList.add("lt-sel-active"); syncRps = parseInt(t.dataset.rps, 10); return;
    }
    if (t.dataset.rate) {
      root.querySelectorAll("#lt-async-rate-group .lt-sel-btn").forEach(function (b) { b.classList.remove("lt-sel-active"); });
      t.classList.add("lt-sel-active"); asyncRate = parseInt(t.dataset.rate, 10); return;
    }
    if (t.dataset.intensity) {
      root.querySelectorAll("#lt-async-int-group .lt-sel-btn").forEach(function (b) { b.classList.remove("lt-sel-active"); });
      t.classList.add("lt-sel-active"); asyncIntensity = parseInt(t.dataset.intensity, 10); return;
    }

    var a = t.dataset.action;
    if (a === "toggle-sync")     { syncRunning  ? stopSync()  : startSync();  return; }
    if (a === "toggle-async")    { asyncRunning ? stopAsync() : startAsync(); return; }
    if (a === "refresh-history") { var f = el("lt-filter-type"); loadHistory(f ? f.value : ""); return; }
    if (a === "clear-history") {
      if (!confirm("Clear all history and records?")) return;
      syncCall("clear_history").then(function () {
        renderHistory([]);
        syncSent = syncOk = syncFail = 0;
        asyncSubmitted = asyncDone = asyncFail = asyncPending = 0;
      }).catch(function (err) { alert("Clear failed: " + err.message); });
    }
  });

  var filterEl = el("lt-filter-type");
  if (filterEl) filterEl.addEventListener("change", function () { loadHistory(filterEl.value); });

  lucide.createIcons();

})();
