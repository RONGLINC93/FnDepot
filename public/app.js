'use strict';

// ---------------------------------------------------------------------------
// 标签页切换
// ---------------------------------------------------------------------------
const tabs = document.querySelectorAll('.tab');
const views = document.querySelectorAll('.view');
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    views.forEach(v => v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function fmtSize(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

// ---------------------------------------------------------------------------
// 加载并渲染应用目录
// ---------------------------------------------------------------------------
async function loadCatalog() {
  const res = await fetch('/api/apps');
  const data = await res.json();

  const src = data.source || {};
  document.getElementById('sourceName').textContent = src.name || 'FnDepot';
  document.getElementById('sourceDesc').textContent = src.description || '飞牛 fnOS 第三方应用源';
  document.title = (src.name || 'FnDepot') + ' · 应用源管理';

  const s = data.summary || {};
  document.getElementById('summary').innerHTML =
    `<span class="chip">应用 <b>${s.totalApps || 0}</b> 个</span>` +
    `<span class="chip">版本 <b>${s.totalVersions || 0}</b> 个</span>` +
    (s.lastUpdated ? `<span class="chip">最近更新 <b>${esc(s.lastUpdated)}</b></span>` : '');

  document.getElementById('footerInfo').textContent =
    (src.name || 'FnDepot') + (src.author ? ' · ' + src.author : '');

  const grid = document.getElementById('appGrid');
  grid.innerHTML = '';
  (data.apps || []).forEach(app => grid.appendChild(renderCard(app)));
}

function renderCard(app) {
  const d = app.detail || {};
  const versions = app.versions || [];
  const latest = versions[0];

  const card = document.createElement('div');
  card.className = 'card';

  // 图标（加载失败回退为首字母）
  const initial = esc((d.display_name || app.name || '?').charAt(0));
  const head = document.createElement('div');
  head.className = 'card-head';
  if (d.icon_url) {
    const img = document.createElement('img');
    img.className = 'app-icon';
    img.src = d.icon_url;
    img.alt = '';
    img.onerror = () => {
      const fb = document.createElement('div');
      fb.className = 'app-icon-fallback';
      fb.textContent = initial;
      img.replaceWith(fb);
    };
    head.appendChild(img);
  } else {
    const fb = document.createElement('div');
    fb.className = 'app-icon-fallback';
    fb.textContent = initial;
    head.appendChild(fb);
  }
  const titleBox = document.createElement('div');
  titleBox.innerHTML =
    `<div class="card-title">${esc(d.display_name || app.name)}</div>` +
    `<div class="card-sub">${esc(app.name)}</div>`;
  head.appendChild(titleBox);
  card.appendChild(head);

  const desc = document.createElement('div');
  desc.className = 'desc';
  desc.textContent = d.desc || '';
  card.appendChild(desc);

  const badges = document.createElement('div');
  badges.className = 'badges';
  (d.categories || []).forEach(c => {
    const b = document.createElement('span');
    b.className = 'badge'; b.textContent = c;
    badges.appendChild(b);
  });
  (d.platform || []).forEach(p => {
    const b = document.createElement('span');
    b.className = 'badge'; b.textContent = '平台: ' + p;
    badges.appendChild(b);
  });
  if (d.service_port) {
    const b = document.createElement('span');
    b.className = 'badge'; b.textContent = '端口: ' + d.service_port;
    badges.appendChild(b);
  }
  card.appendChild(badges);

  const meta = document.createElement('div');
  meta.className = 'meta-row';
  const lat = latest ? d.releases[latest] : null;
  meta.innerHTML =
    `<span>最新版本 <span class="latest-tag">${esc(latest || '—')}</span></span>` +
    `<span>${versions.length} 个版本</span>`;
  card.appendChild(meta);

  // 下载按钮（最新版）
  if (latest && lat && lat.packages && lat.packages.all) {
    const dl = document.createElement('a');
    dl.className = 'btn';
    dl.style.textAlign = 'center';
    dl.href = lat.packages.all.download_url;
    dl.target = '_blank';
    dl.textContent = '下载 ' + latest + (lat.packages.all.size ? ' (' + fmtSize(lat.packages.all.size) + ')' : '');
    card.appendChild(dl);
  }

  // 版本折叠
  if (versions.length > 1) {
    const toggle = document.createElement('button');
    toggle.className = 'toggle-versions';
    toggle.textContent = '▸ 查看全部版本';
    const box = document.createElement('div');
    box.className = 'versions';
    versions.forEach(v => box.appendChild(renderVersion(d.releases[v], v)));
    toggle.addEventListener('click', () => {
      box.classList.toggle('open');
      toggle.textContent = (box.classList.contains('open') ? '▾' : '▸') + ' 查看全部版本';
    });
    card.appendChild(toggle);
    card.appendChild(box);
  }

  // 相关链接
  const links = document.createElement('div');
  links.className = 'links';
  if (d.maintainer_url) links.innerHTML += `<a href="${esc(d.maintainer_url)}" target="_blank">开发者</a>`;
  if (d.readme_url) links.innerHTML += `<a href="${esc(d.readme_url)}" target="_blank">README</a>`;
  if (d.bug_report_url) links.innerHTML += `<a href="${esc(d.bug_report_url)}" target="_blank">反馈</a>`;
  if (links.children.length) card.appendChild(links);

  return card;
}

function renderVersion(rel, version) {
  const item = document.createElement('div');
  item.className = 'ver-item';
  const pkg = rel && rel.packages && rel.packages.all;
  item.innerHTML =
    `<div class="ver-top"><span class="ver-name">${esc(version)}</span>` +
    `<span class="ver-date">${esc(rel && rel.updated_at || '')}</span></div>` +
    (rel && rel.changelog ? `<div class="changelog">${esc(rel.changelog)}</div>` : '') +
    (pkg ? `<a href="${esc(pkg.download_url)}" target="_blank">下载${pkg.size ? ' (' + fmtSize(pkg.size) + ')' : ''}</a>` : '');
  return item;
}

// ---------------------------------------------------------------------------
// 更新管理：通过 SSE 执行脚本
// ---------------------------------------------------------------------------
const logEl = document.getElementById('log');
const statusEl = document.getElementById('runStatus');
const runButtons = document.querySelectorAll('.admin-actions .btn[data-action]');

document.getElementById('clearLog').addEventListener('click', () => { logEl.innerHTML = ''; });

// ---------------------------------------------------------------------------
// 登录鉴权
// ---------------------------------------------------------------------------
const loginBox = document.getElementById('loginBox');
const adminPanel = document.getElementById('adminPanel');
const pwdEl = document.getElementById('pwd');
const loginErr = document.getElementById('loginErr');

function showAdmin(authed) {
  loginBox.style.display = authed ? 'none' : 'block';
  adminPanel.style.display = authed ? 'block' : 'none';
  if (authed) { statusEl.textContent = '空闲'; loadSettings(); }
}

async function checkAuth() {
  try {
    const r = await fetch('/api/me');
    const d = await r.json();
    showAdmin(!!d.authenticated);
  } catch (_) {
    showAdmin(false);
  }
}

async function doLogin() {
  loginErr.textContent = '';
  const r = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pwdEl.value }),
  });
  if (r.ok) {
    pwdEl.value = '';
    showAdmin(true);
  } else {
    const d = await r.json().catch(() => ({}));
    loginErr.textContent = d.error || '登录失败';
  }
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
pwdEl.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showAdmin(false);
});

// ---------------------------------------------------------------------------
// 设置：GITHUB_TOKEN / GITHUB_REPO_URL / 登陆密码（模态框）
// ---------------------------------------------------------------------------
const settingsModal = document.getElementById('settingsModal');

function openSettings() {
  settingsModal.hidden = false;
  document.getElementById('settingStatus').textContent = '';
  document.getElementById('settingStatus').className = 'setting-status';
  loadSettings();
}
function closeSettings() {
  settingsModal.hidden = true;
}
document.getElementById('settingsBtn').addEventListener('click', openSettings);
document.getElementById('settingsCloseBtn').addEventListener('click', closeSettings);
document.getElementById('settingsCancelBtn').addEventListener('click', closeSettings);
settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) closeSettings();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !settingsModal.hidden) closeSettings();
});

function setBadge(id, ok, okText, noText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? okText : noText;
  el.className = 'set-badge' + (ok ? ' on' : '');
}

async function loadSettings() {
  try {
    const r = await fetch('/api/settings');
    if (!r.ok) return;
    const d = await r.json();
    document.getElementById('setRepo').value = d.github_repo_url || '';
    setBadge('badgeToken', d.has_github_token, '已保存', '未保存');
    setBadge('badgeRepo', !!d.github_repo_url, '已保存', '未保存');
    setBadge('badgePassword', d.has_admin_password, '已自定义', '默认 admin');
    const hint = [];
    hint.push(d.has_github_token ? 'GITHUB_TOKEN 已设置' : 'GITHUB_TOKEN 未设置');
    hint.push(d.has_admin_password ? '已设置自定义登陆密码' : '登陆密码为默认 admin');
    document.getElementById('settingHint').textContent = hint.join('；');
  } catch (_) {}
}

document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  const status = document.getElementById('settingStatus');
  status.textContent = '保存中…';
  status.className = 'setting-status';
  const r = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      github_token: document.getElementById('setToken').value,
      github_repo_url: document.getElementById('setRepo').value,
      admin_password: document.getElementById('setPassword').value,
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (d.ok) {
    status.textContent = '已保存';
    status.className = 'setting-status ok';
    document.getElementById('setToken').value = '';
    document.getElementById('setPassword').value = '';
    loadSettings();
    setTimeout(closeSettings, 900);
  } else {
    status.textContent = d.error || '保存失败';
    status.className = 'setting-status err';
  }
});

function appendLog(text, cls) {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

runButtons.forEach(btn => {
  btn.addEventListener('click', () => runTask(btn.dataset.action));
});

let es = null;
function runTask(action) {
  if (es) return;
  runButtons.forEach(b => (b.disabled = true));
  statusEl.textContent = '运行中…';
  statusEl.className = 'status running';
  appendLog('▶ 开始：' + action, 'step');

  es = new EventSource('/api/run?action=' + encodeURIComponent(action));

  es.addEventListener('step', e => {
    const d = JSON.parse(e.data);
    appendLog('=== ' + d.label + ' ===', 'step');
  });
  es.addEventListener('log', e => {
    const d = JSON.parse(e.data);
    appendLog(d.text.replace(/\n$/, ''));
  });
  es.addEventListener('done', e => {
    const d = JSON.parse(e.data);
    if (d.ok) {
      appendLog('✔ 完成', 'step');
      statusEl.textContent = '完成';
      statusEl.className = 'status ok';
    } else {
      appendLog('✘ 失败（步骤：' + (d.step || '') + (d.code ? '，退出码 ' + d.code : '') + '）', 'err');
      statusEl.textContent = '失败';
      statusEl.className = 'status err';
    }
    closeEs();
    loadCatalog(); // 刷新目录（新版本/更新时间）
  });
  es.onerror = () => {
    // 连接已结束（含正常完成或被拒），仅关闭，不重连
    appendLog('· 连接结束', 'step');
    closeEs();
    checkAuth(); // 若因会话失效被拒，自动回到登录态
  };
}

function closeEs() {
  if (es) { es.close(); es = null; }
  runButtons.forEach(b => (b.disabled = false));
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
loadCatalog();
checkAuth();
