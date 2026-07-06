function adminPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>酒旅助手管理后台</title>
  <style>
    :root {
      color-scheme: light;
      --blue: #1677ff;
      --blue-dark: #0b4fd3;
      --bg: #f4f8ff;
      --card: #ffffff;
      --line: #dce8fb;
      --text: #13233a;
      --muted: #6b7a90;
      --warn: #b26b00;
      --error: #c62828;
      --ok: #148a42;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: linear-gradient(135deg, #eef6ff 0%, #f9fbff 45%, #ffffff 100%);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    a { color: inherit; text-decoration: none; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 240px 1fr; }
    .sidebar {
      padding: 28px 22px;
      background: #071b3a;
      color: #fff;
    }
    .brand { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    .sub { color: #a8c4ee; font-size: 13px; margin-bottom: 30px; }
    .nav { display: grid; gap: 10px; }
    .nav a {
      padding: 12px 14px;
      border-radius: 12px;
      color: #dbe9ff;
      font-weight: 600;
    }
    .nav a.active, .nav a:hover { background: rgba(22, 119, 255, 0.24); color: #fff; }
    .main { padding: 30px; }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
    }
    h1 { margin: 0; font-size: 28px; }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: 0 18px 45px rgba(30, 75, 130, 0.08);
      padding: 22px;
      margin-bottom: 18px;
    }
    .login-wrap {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .login-card { width: min(460px, 100%); }
    label { display: block; color: var(--muted); font-size: 13px; margin: 14px 0 7px; }
    input {
      width: 100%;
      height: 44px;
      border: 1px solid #c9daf4;
      border-radius: 12px;
      padding: 0 12px;
      font-size: 15px;
      outline: none;
    }
    input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(22,119,255,.12); }
    button {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      background: var(--blue);
      color: #fff;
      font-weight: 700;
      cursor: pointer;
    }
    button.secondary { background: #edf5ff; color: var(--blue-dark); }
    button.danger { background: #fff1f1; color: var(--error); }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
    .provider-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .metric { color: var(--muted); font-size: 13px; }
    .metric strong { display: block; color: var(--text); font-size: 26px; margin-top: 8px; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 4px 9px;
      border-radius: 999px;
      background: #edf5ff;
      color: var(--blue-dark);
      font-size: 12px;
      font-weight: 700;
    }
    .badge.ok { background: #eaf8ef; color: var(--ok); }
    .badge.warn { background: #fff7e6; color: var(--warn); }
    .badge.error { background: #fff1f1; color: var(--error); }
    .muted { color: var(--muted); }
    .error-text { color: var(--error); }
    .warn-box {
      padding: 12px 14px;
      border-radius: 14px;
      background: #fff7e6;
      color: var(--warn);
      margin-top: 14px;
      line-height: 1.6;
    }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { border-bottom: 1px solid #edf2fb; padding: 12px 8px; text-align: left; }
    .table th { color: var(--muted); font-size: 13px; }
    .modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(5, 18, 40, .45);
      padding: 18px;
    }
    .modal.show { display: flex; }
    .modal .card { width: min(520px, 100%); margin: 0; }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: static; }
      .grid, .provider-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <div id="modal" class="modal" role="dialog" aria-modal="true"></div>
  <script>
    const tokenKey = "jiulv_admin_token";
    const path = location.pathname;
    const app = document.getElementById("app");
    const modal = document.getElementById("modal");
    const providers = ["IHG", "Marriott", "Hilton", "Hyatt", "Accor"];

    function token() { return localStorage.getItem(tokenKey) || ""; }
    function setToken(value) { localStorage.setItem(tokenKey, value); }
    function logout() { localStorage.removeItem(tokenKey); location.href = "/admin/login"; }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function statusBadge(status) {
      const cls = status === "active" ? "ok" : status === "error" || status === "expired" ? "error" : "warn";
      return '<span class="badge ' + cls + '">' + escapeHtml(status || "unknown") + '</span>';
    }
    async function api(url, options = {}) {
      const response = await fetch(url, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
          ...(token() ? { Authorization: "Bearer " + token() } : {}),
        },
      });
      if (response.status === 401 && path !== "/admin/login") {
        location.href = "/admin/login";
        return null;
      }
      const data = await response.json().catch(() => ({ success: false, error: { message: "响应不是 JSON" } }));
      if (!response.ok || data.success === false) {
        const message = data.error?.message || "请求失败";
        const code = data.error?.code || response.status;
        throw new Error(code + ": " + message);
      }
      return data.data;
    }
    function layout(title, content) {
      const nav = [
        ["/admin/dashboard", "Dashboard"],
        ["/admin/providers", "Providers"],
        ["/admin/sync-jobs", "Sync Jobs"],
        ["/admin/sync-logs", "Sync Logs"],
      ];
      app.innerHTML = '<div class="shell"><aside class="sidebar"><div class="brand">酒旅助手后台</div><div class="sub">Provider Sync Console</div><nav class="nav">' +
        nav.map(([href, label]) => '<a class="' + (path === href ? "active" : "") + '" href="' + href + '">' + label + '</a>').join("") +
        '</nav></aside><main class="main"><div class="topbar"><h1>' + title + '</h1><button class="secondary" onclick="logout()">退出登录</button></div>' + content + '</main></div>';
    }
    function renderLogin(message = "") {
      app.innerHTML = '<div class="login-wrap"><div class="card login-card"><h1>管理员登录</h1><p class="muted">登录后可管理五大酒店集团授权与价格同步任务。</p>' +
        '<form id="loginForm"><label>用户名</label><input id="username" autocomplete="username" required />' +
        '<label>密码</label><input id="password" type="password" autocomplete="current-password" required />' +
        '<button style="width:100%;margin-top:18px" type="submit">登录</button></form>' +
        '<div class="warn-box">管理员账号必须由服务器环境变量配置：ADMIN_USERNAME、ADMIN_PASSWORD_HASH、ADMIN_JWT_SECRET。缺失时无法登录。</div>' +
        '<p id="loginMessage" class="error-text">' + escapeHtml(message) + '</p></div></div>';
      document.getElementById("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;
        const messageEl = document.getElementById("loginMessage");
        messageEl.textContent = "";
        try {
          const data = await api("/admin/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
            headers: {},
          });
          setToken(data.accessToken);
          location.href = "/admin/dashboard";
        } catch (error) {
          messageEl.textContent = String(error.message || error);
        }
      });
    }
    async function renderDashboard() {
      const data = await api("/admin/dashboard");
      layout("Dashboard", '<div class="grid">' +
        '<div class="card metric">账号数量<strong>' + data.summary.providerAccounts + '</strong></div>' +
        '<div class="card metric">价格快照<strong>' + data.summary.priceSnapshots + '</strong></div>' +
        '<div class="card metric">同步任务<strong>' + data.summary.syncJobs + '</strong></div>' +
        '</div><div class="card"><h2>定时同步</h2><p>任务：' + escapeHtml(data.cron.name) + '</p><p>计划：' + escapeHtml(data.cron.schedule) + '</p><p>状态：' + escapeHtml(data.cron.status) + '</p></div>');
    }
    function providerCard(item) {
      return '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + escapeHtml(item.provider) + '</h2>' + statusBadge(item.connectionStatus) + '</div>' +
        '<p class="muted">账号：' + escapeHtml(item.usernameMasked || "未录入") + '</p>' +
        '<p>最近同步：' + escapeHtml(item.lastSyncAt || "暂无") + '</p>' +
        '<p>酒店：' + item.syncedHotelCount + ' / 价格：' + item.syncedPriceCount + '</p>' +
        '<p class="error-text">' + escapeHtml(item.recentError || "") + '</p>' +
        '<div class="row"><button onclick="openProviderLogin(\\'' + item.provider + '\\')">登录账号</button>' +
        '<button class="secondary" onclick="testProvider(\\'' + item.provider + '\\')">测试连接</button>' +
        '<button class="secondary" onclick="syncProvider(\\'' + item.provider + '\\')">立即同步</button>' +
        '<a class="badge" href="/admin/sync-logs">查看日志</a></div></div>';
    }
    async function renderProviders() {
      const data = await api("/admin/providers");
      const normalized = providers.map(name => data.find(item => item.provider === name) || { provider: name, connectionStatus: "expired", syncedHotelCount: 0, syncedPriceCount: 0 });
      layout("Providers", '<div class="provider-grid">' + normalized.map(providerCard).join("") + '</div>');
    }
    async function renderJobs() {
      const data = await api("/admin/sync/jobs");
      layout("Sync Jobs", '<div class="card"><table class="table"><thead><tr><th>ID</th><th>集团</th><th>类型</th><th>状态</th><th>开始</th><th>错误</th></tr></thead><tbody>' +
        data.map(item => '<tr><td>' + escapeHtml(item.id) + '</td><td>' + escapeHtml(item.provider || "-") + '</td><td>' + escapeHtml(item.type) + '</td><td>' + statusBadge(item.status) + '</td><td>' + escapeHtml(item.startedAt) + '</td><td>' + escapeHtml(item.errorMessage || "") + '</td></tr>').join("") +
        '</tbody></table></div>');
    }
    async function renderLogs() {
      const data = await api("/admin/sync/logs");
      layout("Sync Logs", '<div class="card"><table class="table"><thead><tr><th>时间</th><th>集团</th><th>级别</th><th>消息</th></tr></thead><tbody>' +
        data.map(item => '<tr><td>' + escapeHtml(item.createdAt) + '</td><td>' + escapeHtml(item.provider || "-") + '</td><td>' + statusBadge(item.level) + '</td><td>' + escapeHtml(item.message || "") + '</td></tr>').join("") +
        '</tbody></table></div>');
    }
    function openProviderLogin(provider) {
      modal.className = "modal show";
      modal.innerHTML = '<div class="card"><h2>' + escapeHtml(provider) + ' 账号授权</h2><p class="muted">请由管理员手动输入。若遇到验证码/MFA，必须人工完成验证，不会自动绕过。</p>' +
        '<label>账号</label><input id="providerUsername" autocomplete="off" />' +
        '<label>密码</label><input id="providerPassword" type="password" autocomplete="off" />' +
        '<div class="row" style="margin-top:18px"><button onclick="saveProviderLogin(\\'' + provider + '\\')">保存加密凭据</button><button class="secondary" onclick="closeModal()">取消</button></div>' +
        '<p id="providerMessage" class="muted"></p></div>';
    }
    function closeModal() { modal.className = "modal"; modal.innerHTML = ""; }
    async function saveProviderLogin(provider) {
      const username = document.getElementById("providerUsername").value;
      const password = document.getElementById("providerPassword").value;
      const messageEl = document.getElementById("providerMessage");
      try {
        const result = await api("/admin/providers/" + provider + "/login", { method: "POST", body: JSON.stringify({ username, password }) });
        messageEl.textContent = "已保存：" + result.usernameMasked + "；状态：" + result.status;
        setTimeout(() => { closeModal(); renderProviders(); }, 700);
      } catch (error) {
        messageEl.textContent = String(error.message || error);
      }
    }
    async function testProvider(provider) {
      try {
        const result = await api("/admin/providers/" + provider + "/test", { method: "POST", body: "{}" });
        alert(result.message || "测试完成");
      } catch (error) { alert(String(error.message || error)); }
    }
    async function syncProvider(provider) {
      try {
        const result = await api("/admin/providers/" + provider + "/sync", { method: "POST", body: "{}" });
        alert("已创建任务：" + result.id + "\\n" + (result.errorMessage || ""));
      } catch (error) { alert(String(error.message || error)); }
    }
    async function boot() {
      try {
        if (path === "/admin/login") { renderLogin(); return; }
        if (!token()) { location.href = "/admin/login"; return; }
        if (path === "/admin/providers") return await renderProviders();
        if (path === "/admin/sync-jobs") return await renderJobs();
        if (path === "/admin/sync-logs") return await renderLogs();
        return await renderDashboard();
      } catch (error) {
        if (path === "/admin/login") renderLogin(String(error.message || error));
        else layout("错误", '<div class="card error-text">' + escapeHtml(error.message || error) + '</div>');
      }
    }
    boot();
  </script>
</body>
</html>`;
}

function wantsHtml(request) {
  return String(request.headers.accept || '').includes('text/html');
}

function sendAdminPage(_request, response) {
  response.type('html').send(adminPageHtml());
}

function maybeSendAdminPage(request, response, next) {
  if (wantsHtml(request)) {
    sendAdminPage(request, response);
    return;
  }
  next();
}

module.exports = {
  maybeSendAdminPage,
  sendAdminPage,
};
