const BACKEND = "https://kvenzikac-backend.up.railway.app";

// ── Auth ──────────────────────────────────────────────────────────────────────
async function checkAuth() {
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    localStorage.setItem("kac_token", urlToken);
    window.history.replaceState({}, "", window.location.pathname);
  }

  const token = localStorage.getItem("kac_token");
  if (!token) { window.location.href = "login.html"; return; }

  try {
    const res  = await fetch(BACKEND + "/auth/verify?token=" + token);
    const data = await res.json();
    if (data.authenticated) {
      showApp(data);
    } else {
      localStorage.removeItem("kac_token");
      window.location.href = "login.html";
    }
  } catch {
    showApp({ username: "Offline", avatar: "", id: "" });
  }
}

async function logout() {
  localStorage.removeItem("kac_token");
  window.location.href = "login.html";
}

let currentUser = null;

function showApp(user) {
  currentUser = user;
  document.getElementById("app").style.display = "flex";

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;

  document.getElementById("sidebar-user").innerHTML = `
    <img src="${avatarUrl}" class="user-avatar" alt="avatar"/>
    <div class="user-info">
      <span class="user-name">${user.username || "Пользователь"}</span>
      <span class="user-role">Администратор</span>
    </div>`;

  refreshDashboard();
  startAutoRefresh();
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────
let refreshInterval = null;
let refreshCountdown = 10;

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshCountdown = 10;
  updateTimer();
  refreshInterval = setInterval(() => {
    refreshCountdown--;
    updateTimer();
    if (refreshCountdown <= 0) {
      refreshCountdown = 10;
      refreshDashboard();
    }
  }, 1000);
}

function updateTimer() {
  const el = document.getElementById("refresh-timer");
  if (el) el.textContent = refreshCountdown + "с";
}

// ── Storage ───────────────────────────────────────────────────────────────────
function getEndpoint() { return localStorage.getItem("kac_endpoint") || BACKEND; }
function getApiKey()   { return localStorage.getItem("kac_apikey")   || "dev-key"; }

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = ["dashboard", "alerts", "players", "bans", "config"];

function showTab(name) {
  TABS.forEach(t => {
    const tab = document.getElementById("tab-" + t);
    const nav = document.getElementById("nav-" + t);
    if (tab) tab.style.display = t === name ? "" : "none";
    if (nav) nav.classList.toggle("active", t === name);
  });
  if (name === "dashboard") refreshDashboard();
  if (name === "alerts")    loadAlerts();
  if (name === "players")   loadPlayers();
  if (name === "bans")      loadBans();
  if (name === "config")    loadConfigTab();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts * 1000);
  const now = Date.now();
  const diff = Math.floor((now - ts * 1000) / 1000);
  if (diff < 60)   return diff + "с назад";
  if (diff < 3600) return Math.floor(diff / 60) + "м назад";
  if (diff < 86400) return Math.floor(diff / 3600) + "ч назад";
  return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function probClass(p) {
  if (p >= 0.9) return "prob-critical";
  if (p >= 0.8) return "prob-high";
  if (p >= 0.7) return "prob-med";
  return "prob-low";
}

function probBar(p) {
  const pct = Math.round(p * 100);
  const cls = probClass(p);
  return `<div class="prob-wrap">
    <span class="prob-badge ${cls}">${pct}%</span>
    <div class="prob-bar"><div class="prob-fill ${cls}" style="width:${pct}%"></div></div>
  </div>`;
}

function setStatus(online) {
  const dot = document.getElementById("sidebar-dot");
  const txt = document.getElementById("sidebar-status");
  if (dot) dot.className = "status-dot " + (online ? "online" : "offline");
  if (txt) txt.textContent = online ? "Online" : "Offline";
}

// ── Chart ─────────────────────────────────────────────────────────────────────
let alertChart = null;

function buildChart(alerts) {
  const canvas = document.getElementById("chart-alerts");
  if (!canvas) return;

  // Группируем по часам за последние 24ч
  const now = Math.floor(Date.now() / 1000);
  const buckets = new Array(24).fill(0);
  const labels  = [];

  for (let i = 23; i >= 0; i--) {
    const h = new Date((now - i * 3600) * 1000);
    labels.push(h.getHours() + ":00");
  }

  alerts.forEach(a => {
    const age = now - a.time;
    if (age < 0 || age > 86400) return;
    const bucket = 23 - Math.floor(age / 3600);
    if (bucket >= 0 && bucket < 24) buckets[bucket]++;
  });

  if (alertChart) alertChart.destroy();

  alertChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        data: buckets,
        backgroundColor: "rgba(124,106,247,.5)",
        borderColor: "rgba(124,106,247,1)",
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => " " + ctx.raw + " алертов" }
      }},
      scales: {
        x: {
          ticks: { color: "#4a4a62", font: { size: 10 }, maxTicksLimit: 8 },
          grid: { color: "#1e1e2e" }
        },
        y: {
          ticks: { color: "#4a4a62", font: { size: 10 }, stepSize: 1 },
          grid: { color: "#1e1e2e" },
          beginAtZero: true
        }
      }
    }
  });
}

// ── Top suspects ──────────────────────────────────────────────────────────────
function buildTopSuspects(alerts) {
  const el = document.getElementById("top-suspects");
  if (!el) return;

  const counts = {};
  const maxProb = {};
  alerts.forEach(a => {
    counts[a.player] = (counts[a.player] || 0) + 1;
    maxProb[a.player] = Math.max(maxProb[a.player] || 0, a.probability);
  });

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (!sorted.length) {
    el.innerHTML = `<div class="empty">Нет данных</div>`;
    return;
  }

  const maxCount = sorted[0][1];
  el.innerHTML = sorted.map(([name, count], i) => {
    const pct = Math.round((count / maxCount) * 100);
    const rankClass = i < 3 ? ` rank-${i + 1}` : "";
    const cls = probClass(maxProb[name]);
    return `<div class="suspect-item">
      <div class="suspect-rank${rankClass}">${i + 1}</div>
      <div class="suspect-name">${name}</div>
      <div class="suspect-count">${count} алертов</div>
      <div class="suspect-bar-wrap">
        <div class="suspect-bar">
          <div class="suspect-bar-fill prob-fill ${cls}" style="width:${pct}%"></div>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  try {
    const res  = await fetch(getEndpoint() + "/stats");
    const data = await res.json();
    document.getElementById("api-status").textContent = "Online";
    document.getElementById("api-status").className   = "card-value ok";
    document.getElementById("model-status").textContent = data.model_loaded ? "Загружена ✓" : "Не загружена";
    document.getElementById("model-status").className   = "card-value " + (data.model_loaded ? "ok" : "err");
    document.getElementById("model-features").textContent = data.n_features ?? "—";
    document.getElementById("alerts-total").textContent   = data.alerts_total ?? "0";
    const bansEl = document.getElementById("bans-total");
    if (bansEl) bansEl.textContent = data.bans_total ?? "0";
    setStatus(true);
  } catch {
    document.getElementById("api-status").textContent = "Offline";
    document.getElementById("api-status").className   = "card-value err";
    setStatus(false);
  }

  try {
    const res  = await fetch(getEndpoint() + "/alerts?api_key=" + getApiKey());
    const data = await res.json();
    const alerts = data.alerts || [];

    // Badge
    const badge = document.getElementById("nav-badge");
    if (badge) {
      const recent = alerts.filter(a => Date.now() / 1000 - a.time < 300).length;
      badge.textContent = recent;
      badge.style.display = recent > 0 ? "" : "none";
    }

    // Recent table
    const tbody = document.getElementById("recent-alerts-body");
    if (tbody) {
      tbody.innerHTML = "";
      const list = alerts.slice(0, 8);
      if (!list.length) {
        tbody.innerHTML = "<tr><td colspan='3' class='empty'>Алертов нет</td></tr>";
      } else {
        list.forEach(a => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td class="player-cell">${a.player}</td><td>${probBar(a.probability)}</td><td class="time-cell">${formatTime(a.time)}</td>`;
          tbody.appendChild(tr);
        });
      }
    }

    buildChart(alerts);
    buildTopSuspects(alerts);
  } catch {
    const tbody = document.getElementById("recent-alerts-body");
    if (tbody) tbody.innerHTML = "<tr><td colspan='3' class='empty'>Ошибка загрузки</td></tr>";
  }

  startAutoRefresh();
}

// ── Alerts ────────────────────────────────────────────────────────────────────
let allAlerts = [];

async function loadAlerts() {
  const tbody = document.getElementById("all-alerts-body");
  if (tbody) tbody.innerHTML = "<tr><td colspan='3' class='empty'>Загрузка...</td></tr>";
  try {
    const res  = await fetch(getEndpoint() + "/alerts?api_key=" + getApiKey());
    const data = await res.json();
    allAlerts = data.alerts || [];
    const sub = document.getElementById("alerts-subtitle");
    if (sub) sub.textContent = `${allAlerts.length} записей`;
    filterAlerts();
  } catch {
    if (tbody) tbody.innerHTML = "<tr><td colspan='3' class='empty'>Ошибка подключения</td></tr>";
  }
}

function filterAlerts() {
  const tbody   = document.getElementById("all-alerts-body");
  const countEl = document.getElementById("alerts-count");
  const playerQ = (document.getElementById("filter-player")?.value || "").toLowerCase();
  const minProb = parseFloat(document.getElementById("filter-prob")?.value) || 0;

  const filtered = allAlerts.filter(a =>
    a.player.toLowerCase().includes(playerQ) && a.probability >= minProb
  );

  if (!tbody) return;
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = "<tr><td colspan='3' class='empty'>Нет совпадений</td></tr>";
    if (countEl) countEl.textContent = "";
    return;
  }
  filtered.forEach(a => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="player-cell">${a.player}</td><td>${probBar(a.probability)}</td><td class="time-cell">${formatTime(a.time)}</td>`;
    tbody.appendChild(tr);
  });
  if (countEl) countEl.textContent = `Показано: ${filtered.length} из ${allAlerts.length}`;
}

// ── Players ───────────────────────────────────────────────────────────────────
async function loadPlayers() {
  const grid = document.getElementById("players-grid");
  if (!grid) return;
  grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Загрузка...</div>`;

  try {
    const res  = await fetch(getEndpoint() + "/alerts?api_key=" + getApiKey());
    const data = await res.json();
    const alerts = data.alerts || [];

    // Группируем по игрокам
    const players = {};
    alerts.forEach(a => {
      if (!players[a.player]) players[a.player] = { name: a.player, alerts: [] };
      players[a.player].alerts.push(a);
    });

    const sorted = Object.values(players)
      .sort((a, b) => b.alerts.length - a.alerts.length);

    if (!sorted.length) {
      grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Нет данных</div>`;
      return;
    }

    grid.innerHTML = sorted.map(p => {
      const probs = p.alerts.map(a => a.probability);
      const avg   = probs.reduce((s, v) => s + v, 0) / probs.length;
      const max   = Math.max(...probs);
      const last5 = probs.slice(0, 5);
      const maxP  = Math.max(...last5, 0.01);

      const bars = last5.map(v => {
        const h = Math.max(4, Math.round((v / maxP) * 28));
        const cls = probClass(v);
        return `<div class="history-bar prob-fill ${cls}" style="height:${h}px" title="${Math.round(v*100)}%"></div>`;
      }).join("");

      const cls = probClass(avg);
      return `<div class="player-card">
        <div class="player-card-header">
          <span class="player-card-name">${p.name}</span>
          <span class="player-card-count">${p.alerts.length} алертов</span>
        </div>
        <div class="player-history">${bars || '<span style="color:var(--muted);font-size:12px">—</span>'}</div>
        <div class="player-card-avg">
          <span>Средняя вероятность</span>
          <span class="${cls}">${Math.round(avg * 100)}%</span>
        </div>
        <div class="player-card-avg">
          <span>Максимум</span>
          <span class="${probClass(max)}">${Math.round(max * 100)}%</span>
        </div>
      </div>`;
    }).join("");
  } catch {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">Ошибка подключения</div>`;
  }
}

// ── Bans ──────────────────────────────────────────────────────────────────────
let allBans = [];

async function loadBans() {
  const tbody = document.getElementById("bans-body");
  if (tbody) tbody.innerHTML = "<tr><td colspan='5' class='empty'>Загрузка...</td></tr>";
  try {
    const res  = await fetch(getEndpoint() + "/bans?api_key=" + getApiKey());
    const data = await res.json();
    allBans = data.bans || [];
    const sub = document.getElementById("bans-subtitle");
    if (sub) sub.textContent = `${allBans.length} записей`;
    // Badge
    const badge = document.getElementById("nav-bans-badge");
    if (badge) {
      badge.textContent = allBans.length;
      badge.style.display = allBans.length > 0 ? "" : "none";
    }
    filterBans();
  } catch {
    if (tbody) tbody.innerHTML = "<tr><td colspan='5' class='empty'>Ошибка подключения</td></tr>";
  }
}

function filterBans() {
  const tbody    = document.getElementById("bans-body");
  const countEl  = document.getElementById("bans-count");
  const playerQ  = (document.getElementById("filter-ban-player")?.value || "").toLowerCase();
  const checkQ   = (document.getElementById("filter-ban-check")?.value || "").toLowerCase();

  const filtered = allBans.filter(b =>
    b.player.toLowerCase().includes(playerQ) &&
    (!checkQ || (b.check || "").toLowerCase() === checkQ)
  );

  if (!tbody) return;
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = "<tr><td colspan='5' class='empty'>Нет совпадений</td></tr>";
    if (countEl) countEl.textContent = "";
    return;
  }
  filtered.forEach(b => {
    const tr = document.createElement("tr");
    const checkBadge = `<span class="check-badge check-${(b.check||'AI').toLowerCase()}">${b.check || 'AI'}</span>`;
    tr.innerHTML = `
      <td class="player-cell">${b.player}</td>
      <td>${checkBadge}</td>
      <td>${probBar(b.probability)}</td>
      <td class="reason-cell">${b.reason || '—'}</td>
      <td class="time-cell">${formatTime(b.time)}</td>`;
    tbody.appendChild(tr);
  });
  if (countEl) countEl.textContent = `Показано: ${filtered.length} из ${allBans.length}`;
}

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfigTab() {
  document.getElementById("endpoint").value = getEndpoint();
  document.getElementById("apikey").value   = getApiKey();
  document.getElementById("config-msg").textContent = "";
  document.getElementById("config-info").innerHTML  = "";

  if (currentUser) {
    const avatarUrl = currentUser.avatar
      ? `https://cdn.discordapp.com/avatars/${currentUser.id}/${currentUser.avatar}.png`
      : `https://cdn.discordapp.com/embed/avatars/0.png`;
    const el = document.getElementById("account-info");
    if (el) el.innerHTML = `
      <img src="${avatarUrl}" alt="avatar"/>
      <div class="account-info-text">
        <span class="account-info-name">${currentUser.username || "—"}</span>
        <span class="account-info-id">ID: ${currentUser.id || "—"}</span>
      </div>`;
  }
}

async function saveConfig() {
  const ep   = document.getElementById("endpoint").value.trim();
  const ak   = document.getElementById("apikey").value.trim();
  const msg  = document.getElementById("config-msg");
  const info = document.getElementById("config-info");
  if (ep) localStorage.setItem("kac_endpoint", ep);
  if (ak) localStorage.setItem("kac_apikey", ak);
  msg.textContent = "Проверяю..."; msg.className = "";
  try {
    const res  = await fetch(ep + "/stats");
    const data = await res.json();
    msg.textContent = "✓ Подключено"; msg.className = "ok";
    info.innerHTML = `
      <div class="info-row"><span>Версия API</span><span>${data.api_version ?? "—"}</span></div>
      <div class="info-row"><span>Модель</span><span>${data.model_loaded ? "Загружена ✓" : "Не загружена"}</span></div>
      <div class="info-row"><span>Фич</span><span>${data.n_features ?? "—"}</span></div>
      <div class="info-row"><span>Алертов</span><span>${data.alerts_total ?? 0}</span></div>`;
  } catch {
    msg.textContent = "✗ Не удалось подключиться"; msg.className = "err";
  }
}

function toggleApiKey() {
  const input = document.getElementById("apikey");
  if (!input) return;
  input.type = input.type === "password" ? "text" : "password";
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", checkAuth);
