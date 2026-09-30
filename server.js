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
// 登录鉴权（仅保护「更新管理」相关接口，应用目录保持公开）
//   - 密码取环境变量 ADMIN_PASSWORD（fnOS 部署时可在应用环境变量中配置）；
//     注意：.env 仅本地开发使用，打包为 fpk 后不存在，故不依赖 .env。
//   - 未设置时回退为 "admin" 并提示修改。
//   - 登录后下发 HttpOnly 会话 Cookie，默认 7 天有效（服务端内存存储，重启即失效）
// ---------------------------------------------------------------------------
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
if (!process.env.ADMIN_PASSWORD) {
  console.log('[提示] 未设置环境变量 ADMIN_PASSWORD，登录密码回退为默认 "admin"。部署到 fnOS 时请在应用环境变量中设置 ADMIN_PASSWORD。');
}
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 天
const sessions = new Map(); // sid -> 过期时间戳

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
// 执行脚本并实时回传日志（Server-Sent Events）
// ---------------------------------------------------------------------------
let running = false;

const STEPS = {
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
