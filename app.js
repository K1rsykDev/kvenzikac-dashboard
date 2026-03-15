const BACKEND = "https://kvenzikac-backend.up.railway.app";

// ── Auth ──────────────────────────────────────────────────────────────────────
function loginDiscord() {
  window.location.href = BACKEND + "/auth/login";
}

async function checkAuth() {
  try {
    const res  = await fetch(BACKEND + "/auth/me", { credentials: "include" });
    const data = await res.json();
    if (data.authenticated) {
      showApp(data);
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

async function logout() {
  await fetch(BACKEND + "/auth/logout", { method: "POST", credentials: "include" });
  showLogin();
}

function showLogin() {
  document.getElementById("login-screen").style.display = "";
  document.getElementById("app").style.display = "none";
}

function showApp(user) {
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app").style.display = "flex";

  // Показываем аватар и ник в сайдбаре
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/0.png`;
  document.getElementById("sidebar-user").innerHTML = `
    <img src="${avatarUrl}" class="user-avatar" alt="avatar"/>
    <span class="user-name">${user.username}</span>
  `;

  refreshDashboard();
  setInterval(refreshDashboard, 10000);
}

// ── Storage ───────────────────────────────────────────────────────────────────
function getEndpoint() { return localStorage.getItem("kac_endpoint") || BACKEND; }
function getApiKey()   { return localStorage.getItem("kac_apikey")   || "dev-key"; }

// ── Tabs ──────────────────────────────────────────────────────────────────────
function showTab(name) {
  ["dashboard", "alerts", "config"].forEach(t => {
    document.getElementById("tab-" + t).style.display = t === name ? "" : "none";
    document.getElementById("nav-" + t).classList.toggle("active", t === name);
  });
  if (name === "dashboard") refreshDashboard();
  if (name === "alerts")    loadAlerts();
  if (name === "config")    loadConfigTab();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU");
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
    <span class="${cls}">${pct}%</span>
    <div class="prob-bar"><div class="prob-fill ${cls}" style="width:${pct}%"></div></div>
  </div>`;
}

function setStatus(online) {
  document.getElementById("sidebar-dot").className = "status-dot " + (online ? "online" : "offline");
  document.getElementById("sidebar-status").textContent = online ? "Online" : "Offline";
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  try {
    const res  = await fetch(getEndpoint() + "/stats", { credentials: "include" });
    const data = await res.json();
    document.getElementById("api-status").textContent   = "Online";
    document.getElementById("api-status").className     = "card-value ok";
    document.getElementById("model-status").textContent = data.model_loaded ? "Загружена ✓" : "Не загружена";
    document.getElementById("model-status").className   = "card-value " + (data.model_loaded ? "ok" : "err");
    document.getElementById("model-features").textContent = data.n_features ?? "—";
    document.getElementById("alerts-total").textContent   = data.alerts_total ?? "0";
    setStatus(true);
  } catch {
    document.getElementById("api-status").textContent = "Offline";
    document.getElementById("api-status").className   = "card-value err";
    setStatus(false);
  }

  const tbody = document.getElementById("recent-alerts-body");
  try {
    const res  = await fetch(getEndpoint() + "/alerts?api_key=" + getApiKey(), { credentials: "include" });
    const data = await res.json();
    tbody.innerHTML = "";
    const list = data.alerts.slice(0, 10);
    if (!list.length) { tbody.innerHTML = "<tr><td colspan='3' class='empty'>Алертов нет</td></tr>"; return; }
    list.forEach(a => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td class="player-cell">${a.player}</td><td>${probBar(a.probability)}</td><td class="time-cell">${formatTime(a.time)}</td>`;
      tbody.appendChild(tr);
    });
  } catch {
    tbody.innerHTML = "<tr><td colspan='3' class='empty'>Ошибка загрузки</td></tr>";
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────
let allAlerts = [];

async function loadAlerts() {
  const tbody = document.getElementById("all-alerts-body");
  tbody.innerHTML = "<tr><td colspan='3' class='empty'>Загрузка...</td></tr>";
  try {
    const res  = await fetch(getEndpoint() + "/alerts?api_key=" + getApiKey(), { credentials: "include" });
    const data = await res.json();
    allAlerts = data.alerts || [];
    filterAlerts();
  } catch {
    tbody.innerHTML = "<tr><td colspan='3' class='empty'>Ошибка подключения</td></tr>";
  }
}

function filterAlerts() {
  const tbody   = document.getElementById("all-alerts-body");
  const countEl = document.getElementById("alerts-count");
  const playerQ = document.getElementById("filter-player").value.toLowerCase();
  const minProb = parseFloat(document.getElementById("filter-prob").value) || 0;
  const filtered = allAlerts.filter(a => a.player.toLowerCase().includes(playerQ) && a.probability >= minProb);
  tbody.innerHTML = "";
  if (!filtered.length) { tbody.innerHTML = "<tr><td colspan='3' class='empty'>Нет совпадений</td></tr>"; countEl.textContent = ""; return; }
  filtered.forEach(a => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="player-cell">${a.player}</td><td>${probBar(a.probability)}</td><td class="time-cell">${formatTime(a.time)}</td>`;
    tbody.appendChild(tr);
  });
  countEl.textContent = `Показано: ${filtered.length} из ${allAlerts.length}`;
}

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfigTab() {
  document.getElementById("endpoint").value = getEndpoint();
  document.getElementById("apikey").value   = getApiKey();
  document.getElementById("config-msg").textContent = "";
  document.getElementById("config-info").innerHTML  = "";
}

async function saveConfig() {
  const ep  = document.getElementById("endpoint").value.trim();
  const ak  = document.getElementById("apikey").value.trim();
  const msg = document.getElementById("config-msg");
  const info = document.getElementById("config-info");
  if (ep) localStorage.setItem("kac_endpoint", ep);
  if (ak) localStorage.setItem("kac_apikey", ak);
  msg.textContent = "Проверяю..."; msg.className = "";
  try {
    const res  = await fetch(ep + "/stats", { credentials: "include" });
    const data = await res.json();
    msg.textContent = "✓ Подключено"; msg.className = "ok";
    info.innerHTML = `
      <div class="info-row"><span>Версия API</span><span>${data.api_version ?? "—"}</span></div>
      <div class="info-row"><span>Модель</span><span>${data.model_loaded ? "Загружена" : "Не загружена"}</span></div>
      <div class="info-row"><span>Фич</span><span>${data.n_features ?? "—"}</span></div>
      <div class="info-row"><span>Алертов</span><span>${data.alerts_total ?? 0}</span></div>`;
  } catch {
    msg.textContent = "✗ Не удалось подключиться"; msg.className = "err";
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", checkAuth);
