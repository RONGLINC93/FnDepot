/**
 * FnDepot 网站服务（零依赖，仅用 Node 内置模块）
 *
 * 提供两个能力：
 *   1) 应用目录：读取 fnpack.json + apps/*.json，以 API 形式供前端展示。
 *   2) 更新管理：通过 SSE 实时执行「更新仓库 / 深度更新 / 推送」等脚本并回传日志。
 *
 * 用法：node server.js          （默认端口 9555，可用 PORT 环境变量覆盖）
 *       或双击 运行网站.bat
 *
 * @author RONGLINC <chenronglin1993@hotmail.com>
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = process.env.PORT || 9555;

// ---------------------------------------------------------------------------
// fnOS 本地应用中心「安装」接口（在设备内由 WebUI 直接触发安装）
//   - base 地址（含端口）来自 Web 设置 fnos_api_url，默认指向本机管理口 5666；
//     若 FnDepot 以 Docker 形式运行，需填宿主机可达地址（如 http://<NAS-IP>:5666
//     或 http://host.docker.internal:5666），不能用 127.0.0.1（那是容器自身）。
//   - 下面的路径与鉴权方式需以 FNOSP/fnnas-api 文档（应用中心模块）或浏览器
//     在「应用中心 → 安装」时抓到的真实请求为准，必要时再微调。
// ---------------------------------------------------------------------------
const FNOS_INSTALL_PATH = '/api/app-center/install'; // TODO: 按实际文档/抓包确认

// ---------------------------------------------------------------------------
// 登录鉴权（仅保护「更新管理」相关接口，应用目录保持公开）
//   - 密码优先取 Web 设置（settings.json）或环境变量 ADMIN_PASSWORD；
//     均未设置时回退为 "admin"。
//   - 登录后下发 HttpOnly 会话 Cookie，默认 7 天有效（服务端内存存储，重启即失效）
// ---------------------------------------------------------------------------
// 用户数据目录：cmd/main 启动服务时会注入 FNDEPOT_DATA_DIR（优先 config/resource
// 声明的共享目录，回退到 TRIM_PKGVAR/data）。卸载时 fnOS 会按用户选择保留该目录，
// 因此设置必须写在这里，而不是会被卸载删除的安装目录。
// 本地直接 `node server.js` 时没有该变量，回退到脚本所在目录，行为与之前一致。
function dataDir() {
  const d = process.env.FNDEPOT_DATA_DIR || process.env.TRIM_PKGVAR;
  if (d) {
    try { fs.mkdirSync(d, { recursive: true }); return d; } catch (_) { /* 不可写则回退 */ }
  }
  return ROOT;
}
const DATA_DIR = dataDir();
// 写回环境变量，确保 spawn 的 update.js / push.js 读写同一份设置
process.env.FNDEPOT_DATA_DIR = DATA_DIR;
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// 旧版本把设置写在安装目录里；迁移一次，避免用户已填的 Token / 密码丢失
(function migrateLegacySettings() {
  if (DATA_DIR === ROOT) return;
  const legacy = path.join(ROOT, 'settings.json');
  if (!fs.existsSync(SETTINGS_FILE) && fs.existsSync(legacy)) {
    try { fs.copyFileSync(legacy, SETTINGS_FILE); } catch (_) { /* 迁移失败不阻塞启动 */ }
  }
})();

// 读取 Web 设置（首次运行不存在时返回空对象）
function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch (_) {
    return {};
  }
}

const settings = loadSettings();

let ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const sessions = new Map(); // sid -> 过期时间戳

// 把 Web 设置合并进运行环境：GITHUB_TOKEN / GITHUB_REPO_URL 注入环境变量（供
// push.js / pull.js 子进程继承），admin_password 覆盖内存中的登录密码。
// Web 设置优先于环境变量默认值，便于 fnOS 部署时无 .env 也能工作。
function applySettings(s) {
  if (s && s.github_token) process.env.GITHUB_TOKEN = s.github_token;
  if (s && s.github_repo_url) process.env.GITHUB_REPO_URL = s.github_repo_url;
  if (s && s.admin_password) ADMIN_PASSWORD = s.admin_password;
}
applySettings(settings);

if (!process.env.ADMIN_PASSWORD && !settings.admin_password) {
  console.log('[提示] 未设置管理密码，登录密码回退为默认 "admin"。可在「更新管理 → 设置」中修改。');
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function readJsonBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (_) { resolve({}); }
    });
  });
}

function authOk(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return false;
  const exp = sessions.get(sid);
  if (!exp) return false;
  if (Date.now() > exp) { sessions.delete(sid); return false; }
  return true;
}

const COOKIE_OPTS = `HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;

async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  if ((body.password || '') === ADMIN_PASSWORD) {
    const sid = crypto.randomBytes(18).toString('hex');
    sessions.set(sid, Date.now() + SESSION_TTL);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `sid=${sid}; ${COOKIE_OPTS}`,
    });
    res.end(JSON.stringify({ ok: true }));
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '密码错误' }));
  }
}

function handleLogout(req, res) {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  });
  res.end(JSON.stringify({ ok: true }));
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.\-+]/);
  const pb = String(b).replace(/^v/, '').split(/[.\-+]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// 加载应用源数据
// ---------------------------------------------------------------------------
function loadApps() {
  let src;
  try {
    src = JSON.parse(fs.readFileSync(path.join(ROOT, 'fnpack.json'), 'utf-8'));
  } catch (e) {
    return { source: null, apps: [], summary: { totalApps: 0, totalVersions: 0, lastUpdated: null } };
  }

  const apps = [];
  let totalVersions = 0;
  let lastUpdated = '';

  for (const [name, meta] of Object.entries(src.apps || {})) {
    let detail = null;
    try {
      detail = JSON.parse(fs.readFileSync(path.join(ROOT, meta.details_url), 'utf-8'));
    } catch (_) {
      continue;
    }
    if (!detail) continue;

    const versions = Object.keys(detail.releases || {}).sort(cmpVersion).reverse();
    totalVersions += versions.length;
    if (meta.details_updated_at && meta.details_updated_at > lastUpdated) {
      lastUpdated = meta.details_updated_at;
    }

    apps.push({
      name,
      details_url: meta.details_url,
      updated_at: meta.details_updated_at || null,
      detail,
      versions,
    });
  }

  return {
    source: src.source_info || null,
    apps,
    summary: { totalApps: apps.length, totalVersions, lastUpdated: lastUpdated || null },
  };
}

// ---------------------------------------------------------------------------
// 文件管理：列举会被推送的仓库文件/目录（需登录）
// ---------------------------------------------------------------------------
function safeJoin(base, rel) {
  const target = path.normalize(path.join(base, rel || ''));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function listDir(rel) {
  const dir = safeJoin(ROOT, rel);
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return null;
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  const entries = [];
  for (const name of names) {
    if (name === '.git' || name === 'node_modules') continue; // 非业务文件，跳过
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    const isDir = st.isDirectory();
    entries.push({
      name,
      type: isDir ? 'dir' : 'file',
      size: isDir ? 0 : st.size,
      mtime: st.mtime.toISOString(),
      rel: path.posix.join(rel || '', name),
    });
  }
  entries.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name) : (a.type === 'dir' ? -1 : 1)
  );
  return { path: rel || '', entries };
}

// ---------------------------------------------------------------------------
// 静态文件
// ---------------------------------------------------------------------------
function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }
  sendFile(res, file);
}

// ---------------------------------------------------------------------------
// 代理到 fnOS 本地应用中心的「安装」接口（在设备内由 WebUI 直接触发）
//   - payload：{ source, appId, version }（source 为本源 homepage，appId 为应用名）
//   - 鉴权：若设置了 fnos_api_token，则以 Bearer 头携带；否则不附加（依赖同一
//     局域网/设备的会话 Cookie，需按实际环境调整）。
// ---------------------------------------------------------------------------
function proxyFnOsInstall(base, token, payload, res) {
  let u;
  try {
    u = new URL(base);
  } catch (_) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'fnOS API 地址格式错误（应为 http://host:port）' }));
    return;
  }
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = {
    hostname: u.hostname,
    port: u.port || 80,
    path: FNOS_INSTALL_PATH,
    method: 'POST',
    headers,
  };
  const r = http.request(opts, resp => {
    let data = '';
    resp.on('data', c => (data += c));
    resp.on('end', () => {
      res.writeHead(resp.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    });
  });
  r.on('error', e => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: '无法连接 fnOS：' + e.message }));
  });
  r.write(JSON.stringify(payload));
  r.end();
}

// ---------------------------------------------------------------------------
// 执行脚本并实时回传日志（Server-Sent Events）
// ---------------------------------------------------------------------------
let running = false;

const STEPS = {
  pull: [['从 GitHub 拉取', ['pull.js']]],
  update: [['更新仓库（仅最新版本）', ['update.js']]],
  deep: [['深度更新（全部版本）', ['update.js', '--deep']]],
  push: [['推送到 GitHub', ['push.js']]],
  oneclick: [['更新仓库（仅最新版本）', ['update.js']], ['推送到 GitHub', ['push.js']]],
};

function runAction(action, res) {
  const steps = STEPS[action];
  if (!steps) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('未知操作');
    return;
  }
  if (running) {
    res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('已有任务正在运行，请稍候');
    return;
  }

  running = true;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  // 不发送 retry，避免客户端在连接结束后自动重连导致脚本重复执行

  const sse = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write('data: ' + JSON.stringify(data) + '\n\n');
  };

  const finish = (ok, info) => {
    running = false;
    sse('done', Object.assign({ ok }, info || {}));
    res.end();
  };

  sse('start', { action });

  let i = 0;
  const next = () => {
    if (i >= steps.length) return finish(true);
    const [label, args] = steps[i++];
    sse('step', { label });
    const cp = spawn(process.execPath, args, { cwd: ROOT, env: process.env });
    cp.stdout.on('data', d => sse('log', { text: d.toString('utf-8') }));
    cp.stderr.on('data', d => sse('log', { text: d.toString('utf-8') }));
    cp.on('error', e => {
      sse('log', { text: '[启动失败] ' + e.message });
      finish(false, { step: label });
    });
    cp.on('close', code => {
      if (code !== 0) return finish(false, { step: label, code });
      next();
    });
  };
  next();
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p === '/api/apps') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(loadApps()));
    return;
  }
  if (p === '/api/login') {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    handleLogin(req, res);
    return;
  }
  if (p === '/api/logout') {
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    handleLogout(req, res);
    return;
  }
  if (p === '/api/me') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ authenticated: authOk(req) }));
    return;
  }
  if (p === '/api/settings') {
    if (!authOk(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '未登录' }));
      return;
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        github_repo_url: settings.github_repo_url || '',
        has_github_token: !!settings.github_token,
        has_admin_password: !!settings.admin_password,
        fnos_api_url: settings.fnos_api_url || '',
        has_fnos_api_token: !!settings.fnos_api_token,
      }));
      return;
    }
    if (req.method === 'POST') {
      readJsonBody(req).then(body => {
        const next = Object.assign({}, settings);
        if (typeof body.github_repo_url === 'string') next.github_repo_url = body.github_repo_url.trim();
        if (typeof body.github_token === 'string' && body.github_token.length > 0) next.github_token = body.github_token;
        if (typeof body.admin_password === 'string' && body.admin_password.length > 0) next.admin_password = body.admin_password;
        if (typeof body.fnos_api_url === 'string') next.fnos_api_url = body.fnos_api_url.trim();
        if (typeof body.fnos_api_token === 'string' && body.fnos_api_token.length > 0) next.fnos_api_token = body.fnos_api_token;
        try {
          fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf-8');
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: '无法写入设置文件：' + e.message }));
          return;
        }
        settings.github_repo_url = next.github_repo_url;
        settings.github_token = next.github_token;
        settings.admin_password = next.admin_password;
        settings.fnos_api_url = next.fnos_api_url;
        settings.fnos_api_token = next.fnos_api_token;
        applySettings(settings);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '方法不支持' }));
    return;
  }
  if (p === '/api/files') {
    if (!authOk(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '未登录' }));
      return;
    }
    const rel = decodeURIComponent(u.searchParams.get('dir') || '');
    const data = listDir(rel);
    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '无效目录' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }
  if (p === '/api/run') {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end();
      return;
    }
    if (!authOk(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '未登录' }));
      return;
    }
    runAction(u.searchParams.get('action') || '', res);
    return;
  }
  if (p === '/api/install') {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    // 说明：安装是特权操作，但本接口仅向用户「自己的 fnOS」转发，且 fnOS 凭据
    // 保存在服务端，不对外暴露。若你的 WebUI 暴露公网，建议改为 require authOk(req)。
    readJsonBody(req).then(body => {
      const base = settings.fnos_api_url;
      if (!base) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: '未配置 fnOS API 地址，请在「更新管理 → 设置」中填写' }));
        return;
      }
      const payload = {
        source: body.source || '',
        appId: body.appId || '',
        version: body.version || '',
      };
      proxyFnOsInstall(base, settings.fnos_api_token, payload, res);
    });
    return;
  }
  if (p.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  serveStatic(req, res, p);
});

server.listen(PORT, () => {
  console.log(`FnDepot 网站已启动: http://localhost:${PORT}`);
});
