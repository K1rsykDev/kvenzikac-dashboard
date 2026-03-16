const BACKEND = "https://kvenzikac-backend.up.railway.app";

// ── Auth ──────────────────────────────────────────────────────────────────────
let currentUser = null;
let currentApiKey = null;

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
    // Если бэкенд вернул не-JSON или упал — не трогаем токен
    if (!res.ok) {
      // 401/403 — токен точно невалидный, чистим
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("kac_token");
        window.location.href = "login.html";
      }
      // Другие ошибки (500, 502, 503) — показываем ошибку, не редиректим
      else {
        showNetworkError("Сервер недоступен (HTTP " + res.status + "). Попробуйте позже.");
      }
      return;
    }
    const data = await res.json();
    if (data.authenticated) {
      await showApp(data);
    } else {
      localStorage.removeItem("kac_token");
      window.location.href = "login.html";
    }
  } catch(e) {
    // Сетевая ошибка (CORS, таймаут, офлайн) — НЕ удаляем токен, показываем ошибку
    showNetworkError("Не удалось подключиться к серверу. Проверьте интернет.");
  }
}

function showNetworkError(msg) {
  document.body.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#080810;color:#e2e2ee;font-family:system-ui;flex-direction:column;gap:16px">' +
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' +
      '<div style="font-size:16px;color:#f87171">' + msg + '</div>' +
      '<button onclick="location.reload()" style="background:#7c6af7;border:none;color:#fff;padding:10px 24px;border-radius:9px;cursor:pointer;font-size:14px">Повторить</button>' +
      '<button onclick="localStorage.removeItem(\'kac_token\');location.href=\'login.html\'" style="background:transparent;border:1px solid #4a4a62;color:#9898b0;padding:8px 20px;border-radius:9px;cursor:pointer;font-size:13px">Выйти</button>' +
    '</div>';
}

async function logout() {
  localStorage.removeItem("kac_token");
  localStorage.removeItem("kac_apikey_cache");
  window.location.href = "login.html";
}

async function showApp(user) {
  currentUser = user;
  document.getElementById("app").style.display = "flex";

  buildLangSwitcher("lang-switcher-sidebar");
  applyLang();

  var avatarUrl = user.avatar
    ? "https://cdn.discordapp.com/avatars/" + user.id + "/" + user.avatar + ".png"
    : "https://cdn.discordapp.com/embed/avatars/0.png";

  var roleLabel = user.role === "admin" ? t("role_admin") : t("role_user");
  document.getElementById("sidebar-user").innerHTML =
    '<img src="' + avatarUrl + '" class="user-avatar" alt="avatar"/>' +
    '<div class="user-info">' +
      '<span class="user-name">' + (user.username || t("role_user")) + '</span>' +
      '<span class="user-role">' + roleLabel + '</span>' +
    '</div>';

  // Показываем/скрываем вкладки по роли
  var adminNav = document.getElementById("nav-admin");
  if (adminNav) adminNav.style.display = user.role === "admin" ? "" : "none";

  // Загружаем API ключ
  await loadMyKey();

  // Инициализируем вкладки
  var allTabs = ["dashboard","alerts","players","bans","connection","config","admin"];
  allTabs.forEach(function(tabId) {
    var tab = document.getElementById("tab-" + tabId);
    var nav = document.getElementById("nav-" + tabId);
    if (tab) tab.style.display = "none";
    if (nav) nav.classList.remove("active");
  });
  showTab("dashboard");
  startAutoRefresh();
}

// ── API Key ───────────────────────────────────────────────────────────────────
async function loadMyKey() {
  const token = localStorage.getItem("kac_token");
  if (!token) return;
  try {
    const res  = await fetch(BACKEND + "/keys/my", {
      headers: { "Authorization": "Bearer " + token }
    });
    const data = await res.json();
    if (data.key) {
      currentApiKey = data.key;
      localStorage.setItem("kac_apikey_cache", data.key);
    } else {
      currentApiKey = null;
    }
  } catch {
    currentApiKey = localStorage.getItem("kac_apikey_cache") || null;
  }
}

function getApiKey() { return currentApiKey || ""; }
function getEndpoint() { return BACKEND; }

// ── Auto-refresh ──────────────────────────────────────────────────────────────
var refreshInterval = null;
var refreshCountdown = 30;

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshCountdown = 30;
  updateTimer();
  refreshInterval = setInterval(function() {
    refreshCountdown--;
    updateTimer();
    if (refreshCountdown <= 0) {
      refreshCountdown = 30;
      var activeTab = document.querySelector(".nav-list li.active");
      if (activeTab) {
        var id = activeTab.id.replace("nav-", "");
        if (id === "dashboard") refreshDashboard();
        if (id === "alerts")    loadAlerts();
        if (id === "bans")      loadBans();
      }
    }
  }, 1000);
}

function updateTimer() {
  var el = document.getElementById("refresh-timer");
  if (el) el.textContent = refreshCountdown + "s";
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
var ALL_TABS = ["dashboard","alerts","players","bans","connection","config","admin"];

function showTab(name) {
  ALL_TABS.forEach(function(t) {
    var tab = document.getElementById("tab-" + t);
    var nav = document.getElementById("nav-" + t);
    if (tab) tab.style.display = t === name ? "" : "none";
    if (nav) nav.classList.toggle("active", t === name);
  });
  if (name === "dashboard")  refreshDashboard();
  if (name === "alerts")     loadAlerts();
  if (name === "players")    loadPlayers();
  if (name === "bans")       loadBans();
  if (name === "connection") loadConnectionTab();
  if (name === "config")     loadConfigTab();
  if (name === "admin")      loadAdminTab();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(ts) {
  var diff = Math.floor((Date.now() - ts * 1000) / 1000);
  if (diff < 60)    return diff + "с назад";
  if (diff < 3600)  return Math.floor(diff / 60) + "м назад";
  if (diff < 86400) return Math.floor(diff / 3600) + "ч назад";
  var d = new Date(ts * 1000);
  return d.toLocaleDateString("ru-RU") + " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function probClass(p) {
  if (p >= 0.9) return "prob-critical";
  if (p >= 0.8) return "prob-high";
  if (p >= 0.7) return "prob-med";
  return "prob-low";
}

function probBar(p) {
  var pct = Math.round(p * 100);
  var cls = probClass(p);
  return '<div class="prob-wrap">' +
    '<span class="prob-badge ' + cls + '">' + pct + '%</span>' +
    '<div class="prob-bar"><div class="prob-fill ' + cls + '" style="width:' + pct + '%"></div></div>' +
  '</div>';
}

function setStatus(online) {
  var dot = document.getElementById("sidebar-dot");
  var txt = document.getElementById("sidebar-status");
  if (dot) dot.className = "status-dot " + (online ? "online" : "offline");
  if (txt) txt.textContent = online ? "Online" : "Offline";
}

function authHeaders() {
  var token = localStorage.getItem("kac_token");
  return token ? { "Authorization": "Bearer " + token } : {};
}

// ── Chart ─────────────────────────────────────────────────────────────────────
var alertChart = null;

function buildChart(alerts) {
  var canvas = document.getElementById("chart-alerts");
  if (!canvas) return;
  var now = Math.floor(Date.now() / 1000);
  var buckets = new Array(24).fill(0);
  var labels  = [];
  for (var i = 23; i >= 0; i--) {
    var h = new Date((now - i * 3600) * 1000);
    labels.push(h.getHours() + ":00");
  }
  alerts.forEach(function(a) {
    var age = now - a.time;
    if (age < 0 || age > 86400) return;
    var bucket = 23 - Math.floor(age / 3600);
    if (bucket >= 0 && bucket < 24) buckets[bucket]++;
  });
  if (alertChart) alertChart.destroy();
  alertChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{ data: buckets, backgroundColor: "rgba(124,106,247,.5)",
        borderColor: "rgba(124,106,247,1)", borderWidth: 1, borderRadius: 4 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: function(ctx) { return " " + ctx.raw + " алертов"; } }
      }},
      scales: {
        x: { ticks: { color: "#4a4a62", font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: "#1e1e2e" } },
        y: { ticks: { color: "#4a4a62", font: { size: 10 }, stepSize: 1 }, grid: { color: "#1e1e2e" }, beginAtZero: true }
      }
    }
  });
}

function buildTopSuspects(alerts) {
  var el = document.getElementById("top-suspects");
  if (!el) return;
  var counts = {}, maxProb = {};
  alerts.forEach(function(a) {
    counts[a.player] = (counts[a.player] || 0) + 1;
    maxProb[a.player] = Math.max(maxProb[a.player] || 0, a.probability);
  });
  var sorted = Object.keys(counts).map(function(k) { return [k, counts[k]]; })
    .sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
  if (!sorted.length) { el.innerHTML = '<div class="empty">' + t("no_data") + '</div>'; return; }
  var maxCount = sorted[0][1];
  el.innerHTML = sorted.map(function(item, i) {
    var name = item[0], count = item[1];
    var pct = Math.round((count / maxCount) * 100);
    var rankClass = i < 3 ? " rank-" + (i + 1) : "";
    var cls = probClass(maxProb[name]);
    return '<div class="suspect-item">' +
      '<div class="suspect-rank' + rankClass + '">' + (i + 1) + '</div>' +
      '<div class="suspect-name">' + name + '</div>' +
      '<div class="suspect-count">' + count + '</div>' +
      '<div class="suspect-bar-wrap"><div class="suspect-bar">' +
        '<div class="suspect-bar-fill prob-fill ' + cls + '" style="width:' + pct + '%"></div>' +
      '</div></div></div>';
  }).join("");
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  var apiKey = getApiKey();
  try {
    var res  = await fetch(BACKEND + "/stats?api_key=" + apiKey);
    var data = await res.json();
    document.getElementById("api-status").textContent = "Online";
    document.getElementById("api-status").className   = "card-value ok";
    document.getElementById("model-status").textContent = data.model_loaded ? t("model_loaded") : t("model_not_loaded");
    document.getElementById("model-status").className   = "card-value " + (data.model_loaded ? "ok" : "err");
    document.getElementById("model-features").textContent = data.n_features || "—";
    document.getElementById("alerts-total").textContent   = data.alerts_total || "0";
    var bansEl = document.getElementById("bans-total");
    if (bansEl) bansEl.textContent = (data.bans_total || 0) + " / " + (data.kicks_total || 0);
    setStatus(true);
  } catch(e) {
    document.getElementById("api-status").textContent = "Offline";
    document.getElementById("api-status").className   = "card-value err";
    setStatus(false);
  }
  if (!apiKey) return;
  try {
    var res2  = await fetch(BACKEND + "/alerts?api_key=" + apiKey);
    var data2 = await res2.json();
    var alerts = data2.alerts || [];
    var badge = document.getElementById("nav-badge");
    if (badge) {
      var recent = alerts.filter(function(a) { return Date.now() / 1000 - a.time < 300; }).length;
      badge.textContent = recent;
      badge.style.display = recent > 0 ? "" : "none";
    }
    var tbody = document.getElementById("recent-alerts-body");
    if (tbody) {
      tbody.innerHTML = "";
      var list = alerts.slice(0, 8);
      if (!list.length) {
        tbody.innerHTML = "<tr><td colspan='3' class='empty'>" + t("no_alerts") + "</td></tr>";
      } else {
        list.forEach(function(a) {
          var tr = document.createElement("tr");
          tr.innerHTML = "<td class='player-cell'>" + a.player + "</td><td>" + probBar(a.probability) + "</td><td class='time-cell'>" + formatTime(a.time) + "</td>";
          tbody.appendChild(tr);
        });
      }
    }
    buildChart(alerts);
    buildTopSuspects(alerts);
  } catch(e) {
    var tbody2 = document.getElementById("recent-alerts-body");
    if (tbody2) tbody2.innerHTML = "<tr><td colspan='3' class='empty'>" + t("load_error") + "</td></tr>";
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────
var allAlerts = [];

async function loadAlerts() {
  var tbody = document.getElementById("all-alerts-body");
  if (tbody) tbody.innerHTML = "<tr><td colspan='3' class='empty'>" + t("no_data") + "</td></tr>";
  if (!getApiKey()) {
    if (tbody) tbody.innerHTML = "<tr><td colspan='3' class='empty'>" + t("no_data") + "</td></tr>";
    return;
  }
  try {
    var res  = await fetch(BACKEND + "/alerts?api_key=" + getApiKey());
    var data = await res.json();
    allAlerts = data.alerts || [];
    var sub = document.getElementById("alerts-subtitle");
    if (sub) sub.textContent = allAlerts.length + " " + t("col_player").toLowerCase();
    filterAlerts();
  } catch(e) {
    if (tbody) tbody.innerHTML = "<tr><td colspan='3' class='empty'>" + t("load_error") + "</td></tr>";
  }
}

function filterAlerts() {
  var tbody   = document.getElementById("all-alerts-body");
  var countEl = document.getElementById("alerts-count");
  var playerQ = (document.getElementById("filter-player") ? document.getElementById("filter-player").value : "").toLowerCase();
  var minProb = parseFloat(document.getElementById("filter-prob") ? document.getElementById("filter-prob").value : "0") || 0;
  var filtered = allAlerts.filter(function(a) {
    return a.player.toLowerCase().indexOf(playerQ) !== -1 && a.probability >= minProb;
  });
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = "<tr><td colspan='3' class='empty'>" + t("no_data") + "</td></tr>";
    if (countEl) countEl.textContent = "";
    return;
  }
  filtered.forEach(function(a) {
    var tr = document.createElement("tr");
    tr.innerHTML = "<td class='player-cell'>" + a.player + "</td><td>" + probBar(a.probability) + "</td><td class='time-cell'>" + formatTime(a.time) + "</td>";
    tbody.appendChild(tr);
  });
  if (countEl) countEl.textContent = t("shown") + " " + filtered.length + " " + t("of") + " " + allAlerts.length;
}

// ── Players ───────────────────────────────────────────────────────────────────
async function loadPlayers() {
  var grid = document.getElementById("players-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + t("no_data") + '</div>';
  if (!getApiKey()) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + t("no_data") + '</div>';
    return;
  }
  try {
    var res  = await fetch(BACKEND + "/alerts?api_key=" + getApiKey());
    var data = await res.json();
    var alerts = data.alerts || [];
    var players = {};
    alerts.forEach(function(a) {
      if (!players[a.player]) players[a.player] = { name: a.player, alerts: [] };
      players[a.player].alerts.push(a);
    });
    var sorted = Object.values(players).sort(function(a, b) { return b.alerts.length - a.alerts.length; });
    if (!sorted.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + t("no_data") + '</div>'; return; }
    grid.innerHTML = sorted.map(function(p) {
      var probs = p.alerts.map(function(a) { return a.probability; });
      var avg   = probs.reduce(function(s, v) { return s + v; }, 0) / probs.length;
      var max   = Math.max.apply(null, probs);
      var last5 = probs.slice(0, 5);
      var maxP  = Math.max.apply(null, last5.concat([0.01]));
      var bars  = last5.map(function(v) {
        var h = Math.max(4, Math.round((v / maxP) * 28));
        return '<div class="history-bar prob-fill ' + probClass(v) + '" style="height:' + h + 'px" title="' + Math.round(v*100) + '%"></div>';
      }).join("");
      return '<div class="player-card">' +
        '<div class="player-card-header"><span class="player-card-name">' + p.name + '</span><span class="player-card-count">' + p.alerts.length + '</span></div>' +
        '<div class="player-history">' + (bars || '<span style="color:var(--muted);font-size:12px">—</span>') + '</div>' +
        '<div class="player-card-avg"><span>' + t("avg_prob") + '</span><span class="' + probClass(avg) + '">' + Math.round(avg * 100) + '%</span></div>' +
        '<div class="player-card-avg"><span>' + t("max_prob") + '</span><span class="' + probClass(max) + '">' + Math.round(max * 100) + '%</span></div>' +
      '</div>';
    }).join("");
  } catch(e) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + t("load_error") + '</div>';
  }
}

// ── Bans/Kicks ────────────────────────────────────────────────────────────────
var allPunishments = [];

async function loadBans() {
  var tbody = document.getElementById("bans-body");
  if (tbody) tbody.innerHTML = "<tr><td colspan='6' class='empty'>" + t("no_data") + "</td></tr>";
  if (!getApiKey()) {
    if (tbody) tbody.innerHTML = "<tr><td colspan='6' class='empty'>" + t("no_data") + "</td></tr>";
    return;
  }
  try {
    var res  = await fetch(BACKEND + "/punishments?api_key=" + getApiKey());
    var data = await res.json();
    allPunishments = data.punishments || [];
    var sub = document.getElementById("bans-subtitle");
    if (sub) sub.textContent = allPunishments.length + " " + t("col_player").toLowerCase();
    var badge = document.getElementById("nav-bans-badge");
    if (badge) {
      var bansOnly = allPunishments.filter(function(p) { return p.type === "ban"; }).length;
      badge.textContent = bansOnly;
      badge.style.display = bansOnly > 0 ? "" : "none";
    }
    filterBans();
  } catch(e) {
    if (tbody) tbody.innerHTML = "<tr><td colspan='6' class='empty'>" + t("load_error") + "</td></tr>";
  }
}

function filterBans() {
  var tbody   = document.getElementById("bans-body");
  var countEl = document.getElementById("bans-count");
  var playerQ = (document.getElementById("filter-ban-player") ? document.getElementById("filter-ban-player").value : "").toLowerCase();
  var typeQ   = document.getElementById("filter-ban-type") ? document.getElementById("filter-ban-type").value : "";
  var filtered = allPunishments.filter(function(b) {
    return b.player.toLowerCase().indexOf(playerQ) !== -1 && (!typeQ || b.type === typeQ);
  });
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = "<tr><td colspan='6' class='empty'>" + t("no_data") + "</td></tr>";
    if (countEl) countEl.textContent = "";
    return;
  }
  filtered.forEach(function(b) {
    var tr = document.createElement("tr");
    var typeBadge = '<span class="check-badge check-' + (b.type === "ban" ? "ban" : "kick") + '">' + (b.type === "ban" ? t("type_ban") : t("type_kick")) + '</span>';
    var checkBadge = '<span class="check-badge check-' + (b.check_name || "ai").toLowerCase() + '">' + (b.check_name || "AI") + '</span>';
    tr.innerHTML = "<td class='player-cell'>" + b.player + "</td><td>" + typeBadge + "</td><td>" + checkBadge + "</td><td>" + probBar(b.probability) + "</td><td class='reason-cell'>" + (b.reason || "—") + "</td><td class='time-cell'>" + formatTime(b.ts) + "</td>";
    tbody.appendChild(tr);
  });
  if (countEl) countEl.textContent = t("shown") + " " + filtered.length + " " + t("of") + " " + allPunishments.length;
}

// ── Connection Tab ────────────────────────────────────────────────────────────
async function loadConnectionTab() {
  var token = localStorage.getItem("kac_token");
  if (!token) return;
  var endpointEl = document.getElementById("conn-endpoint");
  var keyEl      = document.getElementById("conn-key");
  var expiresEl  = document.getElementById("conn-expires");
  var statusEl   = document.getElementById("conn-status");
  var serverEl   = document.getElementById("conn-server-name");
  if (endpointEl) endpointEl.value = BACKEND;
  if (statusEl) statusEl.textContent = "Загрузка...";
  try {
    var res  = await fetch(BACKEND + "/keys/my", { headers: authHeaders() });
    var data = await res.json();
    if (data.key) {
      currentApiKey = data.key;
      localStorage.setItem("kac_apikey_cache", data.key);
      if (keyEl) keyEl.value = data.key;
      if (serverEl) serverEl.value = data.server_name || "";
      if (expiresEl) {
        var now = Math.floor(Date.now() / 1000);
        var left = data.expires_at - now;
        if (left > 0) {
          var days = Math.floor(left / 86400);
          var hours = Math.floor((left % 86400) / 3600);
          expiresEl.textContent = t("expires_in") + " " + days + t("days") + " " + hours + t("hours");
          expiresEl.className = "conn-expires ok";
        } else {
          expiresEl.textContent = t("key_expired");
          expiresEl.className = "conn-expires err";
        }
      }
      if (statusEl) { statusEl.textContent = t("key_active"); statusEl.className = "conn-key-status ok"; }
    } else {
      if (keyEl) keyEl.value = "";
      if (expiresEl) { expiresEl.textContent = t("key_none"); expiresEl.className = "conn-expires err"; }
      if (statusEl) { statusEl.textContent = t("key_none"); statusEl.className = "conn-key-status err"; }
    }
  } catch(e) {
    if (statusEl) { statusEl.textContent = t("load_error"); statusEl.className = "conn-key-status err"; }
  }
  // Обновляем гайд
  var guideEp = document.getElementById("guide-endpoint");
  var guideKey = document.getElementById("guide-key");
  if (guideEp) guideEp.textContent = BACKEND;
  if (guideKey && currentApiKey) guideKey.textContent = currentApiKey;

  // Показываем sub_days
  var subEl = document.getElementById("conn-sub-days");
  if (subEl && currentUser) {
    subEl.textContent = (currentUser.sub_days || 0) + " дней";
    subEl.className = (currentUser.sub_days > 0) ? "ok" : "err";
  }

  // Кнопка пробного периода
  var trialBlock = document.getElementById("trial-block");
  if (trialBlock && currentUser) {
    if (currentUser.trial_used) {
      trialBlock.innerHTML = '<div class="trial-used">' + t("trial_used") + '</div>';
    } else if ((currentUser.sub_days || 0) > 0) {
      trialBlock.innerHTML = '<div class="trial-active ok">' + t("sub_active") + ' (' + currentUser.sub_days + ' ' + t("days") + ')</div>';
    } else {
      trialBlock.innerHTML = '<button class="btn-trial" onclick="activateTrial()">' + t("btn_activate_trial") + '</button>';
    }
  }

  // Кнопка "Испытать" в карточке тарифа
  var pricingTrialBtn = document.getElementById("pricing-trial-btn");
  if (pricingTrialBtn && currentUser) {
    if (currentUser.trial_used) {
      pricingTrialBtn.innerHTML = '<div style="font-size:12px;color:var(--muted);text-align:center">' + t("trial_used").split(".")[0] + '</div>';
    } else if ((currentUser.sub_days || 0) > 0) {
      pricingTrialBtn.innerHTML = '<div style="font-size:12px;color:var(--ok);text-align:center">✓ ' + t("sub_active") + '</div>';
    } else {
      pricingTrialBtn.innerHTML = '<button class="btn-buy btn-buy-trial" onclick="activateTrial()">' + t("btn_try") + '</button>';
    }
  }

  // Показываем план
  var planEl = document.getElementById("conn-plan");
  if (planEl && currentUser) {
    var planKey = currentUser.role === "admin" ? "admin" : (currentUser.plan || "none");
    var planNames2 = { none: t("plan_none"), free: t("plan_free"), basic: t("plan_basic"), premium: t("plan_premium"), admin: t("plan_admin") };
    planEl.textContent = planNames2[planKey] || planKey;
    planEl.className = planKey === "none" ? "err" : "ok";
  }
}

async function activateTrial() {
  var btn = document.querySelector(".btn-trial");
  if (btn) btn.disabled = true;
  try {
    var res  = await fetch(BACKEND + "/trial/activate", { method: "POST", headers: authHeaders() });
    var data = await res.json();
    if (!res.ok) {
      alert("Error: " + (data.detail || res.status));
      if (btn) btn.disabled = false;
      return;
    }
    // Update currentUser
    currentUser.sub_days = data.sub_days;
    currentUser.trial_used = true;
    await loadConnectionTab();
  } catch(e) {
    alert("Connection error");
    if (btn) btn.disabled = false;
  }
}

async function generateKey() {
  var token = localStorage.getItem("kac_token");
  if (!token) return;
  var serverName = (document.getElementById("conn-server-name") ? document.getElementById("conn-server-name").value.trim() : "") || "My Server";
  var btn = document.getElementById("btn-gen-key");
  if (btn) btn.disabled = true;
  try {
    var res  = await fetch(BACKEND + "/keys/generate", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ server_name: serverName })
    });
    var data = await res.json();
    if (!res.ok) {
      alert((res.status === 409 ? "⚠️ " : "Error: ") + (data.detail || res.status));
    } else {
      await loadConnectionTab();
    }
  } catch(e) {
    alert("Connection error");
  }
  if (btn) btn.disabled = false;
}

function copyToClipboard(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var val = el.value || el.textContent;
  navigator.clipboard.writeText(val).then(function() {
    var btn = document.querySelector('[onclick="copyToClipboard(\'' + id + '\')"]');
    if (btn) { var old = btn.textContent; btn.textContent = "✓"; setTimeout(function() { btn.textContent = old; }, 1500); }
  });
}

// ── Config Tab ────────────────────────────────────────────────────────────────
function loadConfigTab() {
  var msg = document.getElementById("config-msg");
  var info = document.getElementById("config-info");
  if (msg) msg.textContent = "";
  if (info) info.innerHTML = "";
  if (currentUser) {
    var avatarUrl = currentUser.avatar
      ? "https://cdn.discordapp.com/avatars/" + currentUser.id + "/" + currentUser.avatar + ".png"
      : "https://cdn.discordapp.com/embed/avatars/0.png";
    var el = document.getElementById("account-info");
    if (el) el.innerHTML =
      '<img src="' + avatarUrl + '" alt="avatar"/>' +
      '<div class="account-info-text">' +
        '<span class="account-info-name">' + (currentUser.username || "—") + '</span>' +
        '<span class="account-info-id">ID: ' + (currentUser.id || "—") + '</span>' +
        '<span class="account-info-id">' + t("col_role") + ': ' + (currentUser.role || "user") + '</span>' +
        '<span class="account-info-id">' + t("subscription") + ': ' + (currentUser.sub_days || 0) + ' ' + t("days") + '</span>' +
      '</div>';
  }
}

async function checkConnection() {
  var msg  = document.getElementById("config-msg");
  var info = document.getElementById("config-info");
  if (msg) { msg.textContent = "..."; msg.className = ""; }
  try {
    var res  = await fetch(BACKEND + "/stats?api_key=" + getApiKey());
    var data = await res.json();
    if (msg) { msg.textContent = "✓ OK"; msg.className = "ok"; }
    if (info) info.innerHTML =
      '<div class="info-row"><span>API</span><span>' + (data.api_version || "—") + '</span></div>' +
      '<div class="info-row"><span>' + t("card_model") + '</span><span>' + (data.model_loaded ? t("model_loaded") : t("model_not_loaded")) + '</span></div>' +
      '<div class="info-row"><span>' + t("card_features") + '</span><span>' + (data.n_features || "—") + '</span></div>' +
      '<div class="info-row"><span>' + t("card_alerts") + '</span><span>' + (data.alerts_total || 0) + '</span></div>';
  } catch(e) {
    if (msg) { msg.textContent = "✗ " + t("load_error"); msg.className = "err"; }
  }
}

// ── Admin Tab ─────────────────────────────────────────────────────────────────
async function loadAdminTab() {
  if (!currentUser || currentUser.role !== "admin") return;
  loadAdminUsers();
  loadAdminServers();
  loadAdminSamples();
  refreshRetrainStatus();
}

async function loadAdminUsers() {
  var tbody = document.getElementById("admin-users-body");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='7' class='empty'>" + t("no_data") + "</td></tr>";
  try {
    var res  = await fetch(BACKEND + "/admin/users", { headers: authHeaders() });
    var data = await res.json();
    var users = data.users || [];
    if (!users.length) { tbody.innerHTML = "<tr><td colspan='7' class='empty'>" + t("no_users") + "</td></tr>"; return; }
    tbody.innerHTML = "";
    var planNames = { none: "—", free: "Free", basic: "Basic", premium: "Premium" };
    users.forEach(function(u) {
      var tr = document.createElement("tr");
      var roleBadge = '<span class="check-badge ' + (u.role === "admin" ? "check-ban" : "check-ai") + '">' + u.role + '</span>';
      var planBadge = u.role === "admin"
        ? '<span class="check-badge check-ban">Admin</span>'
        : '<span class="plan-badge plan-' + (u.plan || "none") + '">' + (planNames[u.plan] || "—") + '</span>';
      var subColor = u.sub_days > 0 ? "ok" : "err";
      tr.innerHTML =
        "<td class='player-cell'>" + u.username + "</td>" +
        "<td style='font-size:11px;color:var(--muted)'>" + u.discord_id + "</td>" +
        "<td>" + roleBadge + "</td>" +
        "<td>" + planBadge + "</td>" +
        "<td><span class='" + subColor + "'>" + u.sub_days + " " + t("days") + "</span></td>" +
        "<td>" + (u.server_name || "—") + "</td>" +
        "<td class='admin-actions'>" +
          "<button class='btn-sm btn-ok' onclick='adminAddSub(\"" + u.discord_id + "\", 30)'>+30" + t("days") + "</button>" +
          "<button class='btn-sm btn-ok' onclick='adminAddSub(\"" + u.discord_id + "\", 7)'>+7" + t("days") + "</button>" +
          "<button class='btn-sm btn-warn' onclick='adminAddSub(\"" + u.discord_id + "\", -7)'>-7" + t("days") + "</button>" +
          "<button class='btn-sm btn-danger' onclick='adminAddSub(\"" + u.discord_id + "\", -999)'>" + t("btn_reset") + "</button>" +
          "<button class='btn-sm btn-accent' onclick='openRoleModal(\"" + u.discord_id + "\", \"" + u.role + "\")'>" + t("btn_change_role") + "</button>" +
          "<button class='btn-sm btn-plan' onclick='openPlanModal(\"" + u.discord_id + "\", \"" + (u.plan || "none") + "\")'>" + t("btn_change_plan") + "</button>" +
        "</td>";
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = "<tr><td colspan='7' class='empty'>" + t("load_error") + "</td></tr>";
  }
}

async function adminAddSub(discordId, days) {
  try {
    var res = await fetch(BACKEND + "/admin/sub", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ discord_id: discordId, days: days })
    });
    var data = await res.json();
    if (!res.ok) { alert("Error: " + (data.detail || res.status)); return; }
    loadAdminUsers();
  } catch(e) { alert("Connection error"); }
}

// ── Plan Modal ────────────────────────────────────────────────────────────────
var _planModalDiscordId = null;

function openPlanModal(discordId, currentPlan) {
  _planModalDiscordId = discordId;
  var modal = document.getElementById("plan-modal");
  if (!modal) return;
  var radios = modal.querySelectorAll("input[name='modal-plan']");
  radios.forEach(function(r) { r.checked = r.value === (currentPlan || "none"); });
  applyLang();
  modal.style.display = "flex";
}

function closePlanModal() {
  var modal = document.getElementById("plan-modal");
  if (modal) modal.style.display = "none";
  _planModalDiscordId = null;
}

async function savePlanModal() {
  if (!_planModalDiscordId) return;
  var selected = document.querySelector("input[name='modal-plan']:checked");
  if (!selected) return;
  var newPlan = selected.value;
  try {
    var res = await fetch(BACKEND + "/admin/plan", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ discord_id: _planModalDiscordId, plan: newPlan })
    });
    if (!res.ok) { var d = await res.json(); alert("Error: " + (d.detail || res.status)); return; }
    closePlanModal();
    loadAdminUsers();
  } catch(e) { alert("Connection error"); }
}
var _roleModalDiscordId = null;

function openRoleModal(discordId, currentRole) {
  _roleModalDiscordId = discordId;
  var modal = document.getElementById("role-modal");
  if (!modal) return;
  // Выбираем текущую роль
  var radios = modal.querySelectorAll("input[name='modal-role']");
  radios.forEach(function(r) { r.checked = r.value === currentRole; });
  // Обновляем тексты через i18n
  applyLang();
  modal.style.display = "flex";
}

function closeRoleModal() {
  var modal = document.getElementById("role-modal");
  if (modal) modal.style.display = "none";
  _roleModalDiscordId = null;
}

async function saveRoleModal() {
  if (!_roleModalDiscordId) return;
  var selected = document.querySelector("input[name='modal-role']:checked");
  if (!selected) return;
  var newRole = selected.value;
  try {
    var res = await fetch(BACKEND + "/admin/role", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({ discord_id: _roleModalDiscordId, role: newRole })
    });
    if (!res.ok) { var d = await res.json(); alert("Error: " + (d.detail || res.status)); return; }
    closeRoleModal();
    loadAdminUsers();
  } catch(e) { alert("Connection error"); }
}

async function loadAdminServers() {
  var tbody = document.getElementById("admin-servers-body");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='5' class='empty'>" + t("no_data") + "</td></tr>";
  try {
    var res  = await fetch(BACKEND + "/admin/servers", { headers: authHeaders() });
    var data = await res.json();
    var servers = data.servers || [];
    if (!servers.length) { tbody.innerHTML = "<tr><td colspan='5' class='empty'>" + t("no_servers") + "</td></tr>"; return; }
    tbody.innerHTML = "";
    servers.forEach(function(s) {
      var tr = document.createElement("tr");
      var now = Math.floor(Date.now() / 1000);
      var active = s.expires_at > now;
      tr.innerHTML =
        "<td class='player-cell'>" + s.server_name + "</td>" +
        "<td>" + s.username + "</td>" +
        "<td style='font-size:11px;color:var(--muted);word-break:break-all'>" + s.key + "</td>" +
        "<td><span class='" + (active ? "ok" : "err") + "'>" + (active ? t("active") : t("expired")) + "</span></td>" +
        "<td>" + s.alerts + " / " + s.bans + "</td>";
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = "<tr><td colspan='5' class='empty'>" + t("load_error") + "</td></tr>";
  }
}

async function loadAdminSamples() {
  var tbody = document.getElementById("admin-samples-body");
  if (!tbody) return;
  tbody.innerHTML = "<tr><td colspan='4' class='empty'>" + t("no_data") + "</td></tr>";
  try {
    var res  = await fetch(BACKEND + "/label/list", { headers: authHeaders() });
    var data = await res.json();
    var samples = data.samples || [];
    var countEl = document.getElementById("admin-samples-count");
    if (countEl) countEl.textContent = samples.length + " " + t("col_label").toLowerCase();
    if (!samples.length) { tbody.innerHTML = "<tr><td colspan='4' class='empty'>" + t("no_samples") + "</td></tr>"; return; }
    tbody.innerHTML = "";
    samples.forEach(function(s) {
      var tr = document.createElement("tr");
      var labelBadge = s.label === 1
        ? '<span class="check-badge check-ban">' + t("label_cheater") + '</span>'
        : '<span class="check-badge check-ai">' + t("label_legit") + '</span>';
      tr.innerHTML =
        "<td class='player-cell'>" + (s.player || "—") + "</td>" +
        "<td>" + labelBadge + "</td>" +
        "<td class='time-cell'>" + formatTime(s.ts) + "</td>" +
        "<td><button class='btn-sm btn-danger' onclick='deleteSample(" + s.id + ")'>" + t("btn_delete") + "</button></td>";
      tbody.appendChild(tr);
    });
  } catch(e) {
    tbody.innerHTML = "<tr><td colspan='4' class='empty'>" + t("load_error") + "</td></tr>";
  }
}

async function deleteSample(id) {
  try {
    await fetch(BACKEND + "/label/" + id, { method: "DELETE", headers: authHeaders() });
    loadAdminSamples();
    refreshRetrainStatus();
  } catch(e) { alert("Error"); }
}

async function clearAllSamples() {
  if (!confirm("Delete all labeled samples?")) return;
  try {
    await fetch(BACKEND + "/label/clear/all", { method: "DELETE", headers: authHeaders() });
    loadAdminSamples();
    refreshRetrainStatus();
  } catch(e) { alert("Error"); }
}

async function refreshRetrainStatus() {
  try {
    var res  = await fetch(BACKEND + "/retrain/status", { headers: authHeaders() });
    var data = await res.json();
    var el = document.getElementById("retrain-status-text");
    if (el) {
      var txt = (data.total || 0) + " samples (Cheater: " + (data.cheaters || 0) + ", Legit: " + (data.legit || 0) + ")";
      if (data.running) txt += " — ⏳ Training...";
      else if (data.last) txt += " — " + formatTime(data.last);
      if (data.error) txt += " — Error: " + data.error;
      el.textContent = txt;
    }
    var btn = document.getElementById("btn-retrain");
    if (btn) btn.disabled = data.running;
  } catch(e) {}
}

async function doRetrain() {
  var btn = document.getElementById("btn-retrain");
  if (btn) btn.disabled = true;
  try {
    var res  = await fetch(BACKEND + "/retrain", { method: "POST", headers: authHeaders() });
    var data = await res.json();
    if (!res.ok) { alert("Error: " + (data.detail || res.status)); if (btn) btn.disabled = false; return; }
    var poll = setInterval(async function() {
      await refreshRetrainStatus();
      var s = await fetch(BACKEND + "/retrain/status", { headers: authHeaders() }).then(function(r) { return r.json(); });
      if (!s.running) clearInterval(poll);
    }, 2000);
  } catch(e) {
    alert("Connection error");
    if (btn) btn.disabled = false;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", checkAuth);
