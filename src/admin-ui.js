const ADMIN_BUILD_VERSION = 'admin-login-stability-v1';

function adminPageHtml() {
  const adminBuildTime = new Date().toISOString();

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
    .sidebar { padding: 28px 22px; background: #071b3a; color: #fff; }
    .brand { font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    .sub { color: #a8c4ee; font-size: 13px; margin-bottom: 30px; }
    .nav { display: grid; gap: 10px; }
    .nav a { padding: 12px 14px; border-radius: 12px; color: #dbe9ff; font-weight: 600; }
    .nav a.active, .nav a:hover { background: rgba(22, 119, 255, 0.24); color: #fff; }
    .main { padding: 30px; }
    .topbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 0 0 12px; }
    .card {
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 20px;
      box-shadow: 0 18px 45px rgba(30, 75, 130, 0.08);
      padding: 22px;
      margin-bottom: 18px;
    }
    .login-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .login-card { width: min(500px, 100%); }
    label { display: block; color: var(--muted); font-size: 13px; margin: 14px 0 7px; }
    input, textarea {
      width: 100%;
      border: 1px solid #c9daf4;
      border-radius: 12px;
      padding: 0 12px;
      font-size: 15px;
      outline: none;
    }
    input { height: 44px; }
    textarea { min-height: 150px; padding: 12px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    input:focus, textarea:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(22,119,255,.12); }
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
    .error-text { color: var(--error); white-space: pre-wrap; }
    .success-text { color: var(--ok); }
    .warn-box {
      padding: 12px 14px;
      border-radius: 14px;
      background: #fff7e6;
      color: var(--warn);
      margin-top: 14px;
      line-height: 1.6;
    }
    .diagnostics {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px dashed #c9daf4;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.7;
      word-break: break-all;
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
      .grid, .provider-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div id="app"></div>
  <div id="modal" class="modal" role="dialog" aria-modal="true"></div>
  <script>
    const adminBuildVersion = ${JSON.stringify(ADMIN_BUILD_VERSION)};
    const adminBuildTime = ${JSON.stringify(adminBuildTime)};
    const tokenKey = "admin_token";
    const legacyTokenKey = "jiulv_admin_token";
    const loginAtKey = "admin_login_at";
    const path = location.pathname;
    const app = document.getElementById("app");
    const modal = document.getElementById("modal");
    const providers = ["IHG", "Marriott", "Hilton", "Hyatt", "Accor"];
    const retryDelays = [500, 1500];
    let lastRequestStatus = "none";

    function token() {
      return localStorage.getItem(tokenKey) || localStorage.getItem(legacyTokenKey) || "";
    }
    function setToken(value) {
      localStorage.setItem(tokenKey, value);
      localStorage.setItem(loginAtKey, new Date().toISOString());
      localStorage.removeItem(legacyTokenKey);
    }
    function clearToken() {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(legacyTokenKey);
      localStorage.removeItem(loginAtKey);
    }
    function logout() {
      clearToken();
      location.href = "/admin/login";
    }
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
    }
    function statusBadge(status) {
      const cls = status === "active" || status === "success" || status === "info" || status === "manual_authorized" || status === "session_authorized"
        ? "ok"
        : status === "error" || status === "expired" || status === "failed"
          ? "error"
          : "warn";
      return '<span class="badge ' + cls + '">' + escapeHtml(status || "unknown") + '</span>';
    }
    function classifyNetworkError(error) {
      if (error?.name === "AbortError") return { code: "NETWORK_TIMEOUT", message: "请求超时，请关闭代理/VPN后重试，或稍后重试。" };
      const message = String(error?.message || error || "");
      if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(message)) {
        return { code: "NETWORK_FAILED", message: "网络连接失败，请关闭代理/VPN后重试，或稍后重试。" };
      }
      if (/TLS|SSL|DNS|ERR_NAME|ERR_CERT|ERR_CONNECTION|ERR_TIMED_OUT/i.test(message)) {
        return { code: "TLS_OR_DNS_FAILED", message: "TLS/DNS/连接失败，请检查网络、代理或稍后重试。" };
      }
      return { code: "NETWORK_FAILED", message: "网络连接失败，请关闭代理/VPN后重试，或稍后重试。" };
    }
    function normalizeError(response, payload) {
      if (response.status >= 500) {
        return { code: "SERVER_5XX", message: "服务器暂时不可用，请稍后重试。" };
      }
      if (response.status === 401) {
        return payload?.error || { code: "UNAUTHORIZED", message: "未登录或登录已过期。" };
      }
      return payload?.error || { code: "REQUEST_FAILED", message: "请求失败。" };
    }
    async function adminFetch(url, options = {}) {
      if (!url.startsWith("/")) {
        throw new Error("INVALID_ADMIN_URL: admin request must use same-origin relative path");
      }
      let lastError;
      for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || 10000);
        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              ...(options.headers || {}),
              ...(token() ? { Authorization: "Bearer " + token() } : {}),
            },
          });
          clearTimeout(timer);
          const payload = await response.json().catch(() => null);
          lastRequestStatus = response.status + " " + url;
          updateDiagnostics();

          if (response.status === 401 && url !== "/admin/login") {
            clearToken();
            location.href = "/admin/login";
            return null;
          }
          if (!response.ok || payload?.success === false) {
            const normalized = normalizeError(response, payload);
            if (url === "/admin/login" && normalized.code === "UNAUTHORIZED") {
              normalized.code = "INVALID_CREDENTIALS";
              normalized.message = "用户名或密码错误。";
            }
            throw Object.assign(new Error(normalized.code + ": " + normalized.message), normalized);
          }
          return payload?.success === true && "data" in payload ? payload.data : payload;
        } catch (error) {
          clearTimeout(timer);
          lastError = error.code ? error : Object.assign(new Error(), classifyNetworkError(error));
          lastRequestStatus = lastError.code + " " + url;
          updateDiagnostics();
          if (attempt < retryDelays.length && !["INVALID_CREDENTIALS", "UNAUTHORIZED", "ADMIN_NOT_CONFIGURED"].includes(lastError.code)) {
            await sleep(retryDelays[attempt]);
            continue;
          }
          throw lastError;
        }
      }
      throw lastError;
    }
    function extractLoginToken(data) {
      return data?.token || data?.accessToken || data?.data?.token || data?.data?.accessToken || "";
    }
    function diagnosticsHtml() {
      return '<div class="diagnostics" id="diagnostics">' +
        '<div>API Origin: same-origin (' + escapeHtml(location.origin) + ')</div>' +
        '<div>Admin UI Build: ' + escapeHtml(adminBuildVersion) + ' / ' + escapeHtml(adminBuildTime) + '</div>' +
        '<div>Browser Network: ' + (navigator.onLine ? "online" : "offline") + '</div>' +
        '<div>Last Request: ' + escapeHtml(lastRequestStatus) + '</div>' +
        '<div>Token Present: ' + (token() ? "YES" : "NO") + '</div>' +
        '</div>';
    }
    function updateDiagnostics() {
      const target = document.getElementById("diagnostics");
      if (target) target.outerHTML = diagnosticsHtml();
    }
    window.addEventListener("online", updateDiagnostics);
    window.addEventListener("offline", updateDiagnostics);
    function layout(title, content) {
      const nav = [
        ["/admin/dashboard", "Dashboard"],
        ["/admin/providers", "Providers"],
        ["/admin/sync-jobs", "Sync Jobs"],
        ["/admin/sync-logs", "Sync Logs"],
      ];
      app.innerHTML = '<div class="shell"><aside class="sidebar"><div class="brand">酒旅助手后台</div><div class="sub">Provider Sync Console</div><nav class="nav">' +
        nav.map(([href, label]) => '<a class="' + (path === href ? "active" : "") + '" href="' + href + '">' + label + '</a>').join("") +
        '</nav></aside><main class="main"><div class="topbar"><h1>' + title + '</h1><button class="secondary" onclick="logout()">退出登录</button></div>' + content + diagnosticsHtml() + '</main></div>';
    }
    function renderLogin(message = "") {
      app.innerHTML = '<div class="login-wrap"><div class="card login-card"><h1>管理员登录</h1><p class="muted">登录后可管理五大酒店集团授权与价格同步任务。</p>' +
        '<form id="loginForm"><label>用户名</label><input id="username" autocomplete="username" required />' +
        '<label>密码</label><input id="password" type="password" autocomplete="current-password" required />' +
        '<button id="loginButton" style="width:100%;margin-top:18px" type="submit">登录</button></form>' +
        '<p id="loginMessage" class="error-text">' + escapeHtml(message) + '</p>' +
        '<div class="warn-box">如果网络失败，请关闭代理/VPN后重试。管理员账号由服务器环境变量配置，不会在页面中显示。</div>' +
        diagnosticsHtml() + '</div></div>';
      document.getElementById("loginForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;
        const messageEl = document.getElementById("loginMessage");
        const button = document.getElementById("loginButton");
        messageEl.textContent = "";
        button.disabled = true;
        button.textContent = "登录中...";
        try {
          const data = await adminFetch("/admin/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
          });
          const nextToken = extractLoginToken(data);
          if (!nextToken) {
            throw Object.assign(new Error("LOGIN_RESPONSE_MISSING_TOKEN: 登录成功但响应缺少 token。"), {
              code: "LOGIN_RESPONSE_MISSING_TOKEN",
            });
          }
          setToken(nextToken);
          lastRequestStatus = "LOGIN_OK /admin/login";
          updateDiagnostics();
          location.assign("/admin/dashboard");
        } catch (error) {
          messageEl.textContent = String(error.code ? error.code + ": " + error.message : error.message || error);
        } finally {
          button.disabled = false;
          button.textContent = "登录";
        }
      });
    }
    async function renderDashboard() {
      const data = await adminFetch("/admin/dashboard");
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
        '<button class="secondary" onclick="syncProvider(\\'' + item.provider + '\\')">同步真实价格</button>' +
        '<a class="badge" href="/admin/sync-logs">查看日志</a></div></div>';
    }
    function providerCard(item) {
      const recentErrorClass = item.connectionStatus === "manual_authorized" ? "success-text" : "error-text";
      return '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + escapeHtml(item.provider) + '</h2>' + statusBadge(item.connectionStatus) + '</div>' +
        '<p class="muted">账号：' + escapeHtml(item.usernameMasked || "未录入") + '</p>' +
        '<p>最近同步：' + escapeHtml(item.lastSyncAt || "暂无") + '</p>' +
        '<p>酒店：' + item.syncedHotelCount + ' / 价格：' + item.syncedPriceCount + '</p>' +
        '<p class="' + recentErrorClass + '">' + escapeHtml(item.recentError || "") + '</p>' +
        '<div class="row"><button onclick="openProviderLogin(\\'' + item.provider + '\\')">登录账号</button>' +
        '<button class="secondary" onclick="manualAuthorizeProvider(\\'' + item.provider + '\\')">人工授权</button>' +
        '<button class="secondary" onclick="testProvider(\\'' + item.provider + '\\')">测试连接</button>' +
        '<button class="secondary" onclick="syncProvider(\\'' + item.provider + '\\')">立即同步</button>' +
        '<a class="badge" href="/admin/sync-logs">查看日志</a></div></div>';
    }

    function providerCardV2(item) {
      const isIhg = item.provider === "IHG";
      const goodStatus = ["active", "manual_authorized", "session_authorized"].includes(item.connectionStatus);
      const recentErrorClass = goodStatus ? "success-text" : "error-text";
      const ihgActions = isIhg
        ? '<button class="secondary" onclick="startPlaywrightAuthorization(\\'' + item.provider + '\\')">IHG Playwright授权</button>' +
          '<button class="secondary" onclick="openPlaywrightSessionModal(\\'' + item.provider + '\\')">保存Session</button>'
        : '';
      return '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + escapeHtml(item.provider) + '</h2>' + statusBadge(item.connectionStatus) + '</div>' +
        '<p class="muted">账号：' + escapeHtml(item.usernameMasked || "未录入") + '</p>' +
        '<p>最近同步：' + escapeHtml(item.lastSyncAt || "暂无") + '</p>' +
        '<p>酒店：' + item.syncedHotelCount + ' / 价格：' + item.syncedPriceCount + '</p>' +
        '<p class="muted">同步窗口：' + escapeHtml(item.syncWindowDays || 90) + ' 天</p>' +
        '<p class="' + recentErrorClass + '">' + escapeHtml(item.recentError || "") + '</p>' +
        '<div class="row"><button onclick="openProviderLogin(\\'' + item.provider + '\\')">登录账号</button>' +
        '<button class="secondary" onclick="manualAuthorizeProvider(\\'' + item.provider + '\\')">人工授权</button>' +
        ihgActions +
        '<button class="secondary" onclick="testProvider(\\'' + item.provider + '\\')">测试连接</button>' +
        '<button class="secondary" onclick="syncProvider(\\'' + item.provider + '\\')">同步90天价格</button>' +
        '<a class="badge" href="/admin/sync-logs">查看日志</a></div></div>';
    }

    async function renderProviders() {
      const data = await adminFetch("/admin/providers");
      const normalized = providers.map(name => data.find(item => item.provider === name) || { provider: name, connectionStatus: "expired", syncedHotelCount: 0, syncedPriceCount: 0 });
      layout("Providers", '<div class="provider-grid">' + normalized.map(providerCardV2).join("") + '</div>');
    }
    async function renderJobs() {
      const data = await adminFetch("/admin/sync/jobs");
      layout("Sync Jobs", '<div class="card"><table class="table"><thead><tr><th>ID</th><th>集团</th><th>类型</th><th>状态</th><th>开始</th><th>错误</th></tr></thead><tbody>' +
        data.map(item => '<tr><td>' + escapeHtml(item.id) + '</td><td>' + escapeHtml(item.provider || "-") + '</td><td>' + escapeHtml(item.type) + '</td><td>' + statusBadge(item.status) + '</td><td>' + escapeHtml(item.startedAt) + '</td><td>' + escapeHtml(item.errorMessage || "") + '</td></tr>').join("") +
        '</tbody></table></div>');
    }
    async function renderLogs() {
      const data = await adminFetch("/admin/sync/logs");
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
        const result = await adminFetch("/admin/providers/" + provider + "/login", { method: "POST", body: JSON.stringify({ username, password }) });
        messageEl.textContent = "已保存：" + result.usernameMasked + "；状态：" + result.status;
        setTimeout(() => { closeModal(); renderProviders(); }, 700);
      } catch (error) {
        messageEl.textContent = String(error.code ? error.code + ": " + error.message : error.message || error);
      }
    }
    async function testProvider(provider) {
      try {
        const result = await adminFetch("/admin/providers/" + provider + "/test", { method: "POST", body: "{}" });
        alert(result.message || "测试完成");
      } catch (error) { alert(String(error.code ? error.code + ": " + error.message : error.message || error)); }
    }
    async function manualAuthorizeProvider(provider) {
      const ok = confirm(provider + " 将被标记为人工授权。\\n\\n这只表示管理员已确认账号由本人录入；不会伪造官方 API/OAuth，也不会绕过验证码/MFA。\\n\\n继续吗？");
      if (!ok) return;
      try {
        const result = await adminFetch("/admin/providers/" + provider + "/manual-authorize", {
          method: "POST",
          body: JSON.stringify({ note: "Confirmed from admin console." }),
        });
        alert(result.message || "已人工授权");
        await renderProviders();
      } catch (error) {
        alert(String(error.code ? error.code + ": " + error.message : error.message || error));
      }
    }

    async function startPlaywrightAuthorization(provider) {
      if (provider !== "IHG") {
        alert("当前阶段只支持 IHG Playwright 授权。");
        return;
      }
      try {
        const result = await adminFetch("/admin/providers/" + provider + "/playwright/start", {
          method: "POST",
          body: JSON.stringify({ days: 90 }),
        });
        modal.className = "modal show";
        modal.innerHTML = '<div class="card"><h2>IHG Playwright 人工授权</h2>' +
          '<p>同步窗口：' + escapeHtml(result.days) + ' 天</p>' +
          '<p>请打开 IHG 登录页，手动完成账号、验证码/MFA。完成后导出 Playwright storageState JSON，再点“保存Session”。</p>' +
          '<p><a class="badge" target="_blank" rel="noopener" href="' + escapeHtml(result.loginUrl) + '">打开 IHG 登录页</a></p>' +
          '<div class="warn-box">不会绕过验证码、MFA 或风控；没有真实 session 时不会写入真实价格。</div>' +
          '<div class="row" style="margin-top:18px"><button onclick="openPlaywrightSessionModal(\\'' + provider + '\\')">保存Session</button><button class="secondary" onclick="closeModal()">关闭</button></div></div>';
        await renderProviders();
      } catch (error) {
        alert(String(error.code ? error.code + ": " + error.message : error.message || error));
      }
    }

    function openPlaywrightSessionModal(provider) {
      modal.className = "modal show";
      modal.innerHTML = '<div class="card"><h2>' + escapeHtml(provider) + ' 保存 Playwright Session</h2>' +
        '<p class="muted">粘贴 Playwright storageState JSON。Cookie 会加密保存，接口不会返回 Cookie 内容。</p>' +
        '<label>storageState JSON</label><textarea id="playwrightStorageState" autocomplete="off" placeholder="{ &quot;cookies&quot;: [], &quot;origins&quot;: [] }"></textarea>' +
        '<label>同步天数</label><input id="playwrightDays" value="90" inputmode="numeric" />' +
        '<div class="row" style="margin-top:18px"><button onclick="savePlaywrightSession(\\'' + provider + '\\')">加密保存Session</button><button class="secondary" onclick="closeModal()">取消</button></div>' +
        '<p id="playwrightSessionMessage" class="muted"></p></div>';
    }

    async function savePlaywrightSession(provider) {
      const messageEl = document.getElementById("playwrightSessionMessage");
      try {
        const raw = document.getElementById("playwrightStorageState").value;
        const days = Number(document.getElementById("playwrightDays").value || 90);
        const storageState = JSON.parse(raw);
        const result = await adminFetch("/admin/providers/" + provider + "/playwright/session", {
          method: "POST",
          body: JSON.stringify({ storageState, days }),
        });
        messageEl.textContent = "已保存Session；Cookie数量：" + result.cookieCount + "；同步窗口：" + result.days + "天";
        setTimeout(() => { closeModal(); renderProviders(); }, 900);
      } catch (error) {
        messageEl.textContent = String(error.code ? error.code + ": " + error.message : error.message || error);
      }
    }

    async function syncProvider(provider) {
      try {
        const result = await adminFetch("/admin/providers/" + provider + "/sync", { method: "POST", body: JSON.stringify({ days: 90 }) });
        alert("已创建任务：" + result.id + "\\n" + (result.errorMessage || ""));
      } catch (error) { alert(String(error.code ? error.code + ": " + error.message : error.message || error)); }
    }
    async function boot() {
      try {
        if (path === "/admin/login") { renderLogin(); return; }
        if (!token()) { location.replace("/admin/login"); return; }
        if (path === "/admin/providers") return await renderProviders();
        if (path === "/admin/sync-jobs") return await renderJobs();
        if (path === "/admin/sync-logs") return await renderLogs();
        return await renderDashboard();
      } catch (error) {
        if (path === "/admin/login") renderLogin(String(error.message || error));
        else layout("错误", '<div class="card error-text">' + escapeHtml(error.code ? error.code + ": " + error.message : error.message || error) + '</div>');
      }
    }
    boot();
  </script>
</body>
</html>`;
}

function setNoCacheHeaders(response) {
  response.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
}

function wantsHtml(request) {
  return String(request.headers.accept || '').includes('text/html');
}

function sendAdminPage(_request, response) {
  setNoCacheHeaders(response);
  response.type('html');
  response.status(200);
  response.end(adminPageHtml());
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
