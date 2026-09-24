/**
 * 自动更新应用源：扫描 GitHub 账号下所有仓库的 Release，找出 .fpk 安装包，
 * 下载后解析 FPK 内的 manifest（appname / version / display_name / desc 等），
 * 再把新应用或新版本写入 fnpack.json 与 apps/*.json。
 *
 * 已存在应用的分类、图标等人工字段会被保留，不会被覆盖。
 * 用法：node update.js   （或双击 更新.bat）
 *
 * @author RONGLINC <chenronglin1993@hotmail.com>
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');

const ROOT = __dirname;
const UA = { 'User-Agent': 'FnDepot-updater' };

// 新应用的分类提示表，未命中时归到「系统工具」并提示人工调整
const CATEGORY_HINT = {
  'student-management-system': ['教育学习'],
  umweb: ['影音娱乐'],
  reminder: ['生活服务'],
};
const DEFAULT_CATEGORY = ['系统工具'];

// ---------------------------------------------------------------------------
// .env
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('[错误] 未找到 .env 文件，请先复制 .env.example 为 .env 并填写 GITHUB_REPO_URL 和 GITHUB_TOKEN');
    process.exit(1);
  }
  const env = {};
  fs.readFileSync(envPath, 'utf-8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  });
  return env;
}

const env = loadEnv();
const token = (env.GITHUB_TOKEN || '').trim();
const repoUrl = (env.GITHUB_REPO_URL || '').trim();
if (!repoUrl || !token) {
  console.error('[错误] .env 中缺少 GITHUB_REPO_URL 或 GITHUB_TOKEN');
  process.exit(1);
}
const m = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
if (!m) {
  console.error('[错误] 无法从 GITHUB_REPO_URL 解析用户名：' + repoUrl);
  process.exit(1);
}
const OWNER = m[1];
const SELF_REPO = m[2];

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
function request(url, opts = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = Object.assign({}, UA, opts.headers || {});
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: opts.method || 'GET', headers },
      res => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && redirects < 5) {
          res.resume();
          return resolve(request(loc, opts, redirects + 1));
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function api(pathname) {
  const res = await request(`https://api.github.com${pathname}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (res.status !== 200) {
    throw new Error(`GitHub API ${pathname} 返回 ${res.status}`);
  }
  return JSON.parse(res.body.toString('utf-8'));
}

async function head(url) {
  try {
    const res = await request(url, { method: 'HEAD' });
    return res.status;
  } catch (e) {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// FPK：tar.gz 内读取 manifest（key = value 格式）
// ---------------------------------------------------------------------------
function readFromTarGz(buf, want) {
  let tar;
  try {
    tar = zlib.gunzipSync(buf);
  } catch (e) {
    return null;
  }
  let off = 0;
  while (off + 512 <= tar.length) {
    const name = tar.toString('utf-8', off, off + 100).replace(/\0.*$/, '');
    if (!name) break;
    const sizeStr = tar.toString('utf-8', off + 124, off + 136).replace(/\0.*$/, '').trim();
    const size = parseInt(sizeStr, 8) || 0;
    const typeflag = tar[off + 156];
    const start = off + 512;
    if ((typeflag === 0 || typeflag === 0x30) && want.indexOf(path.basename(name)) !== -1) {
      return tar.slice(start, start + size).toString('utf-8');
    }
    off = start + Math.ceil(size / 512) * 512;
  }
  return null;
}

function parseManifest(text) {
  const out = {};
  String(text || '').split(/\r?\n/).forEach(line => {
    const kv = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (kv) out[kv[1]] = kv[2].trim();
  });
  return out;
}

function sha256(buf) {
  return require('crypto').createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// 版本比较
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

// 固定使用中国时区（Asia/Shanghai, +08:00），避免依赖运行机器的本地时区
function localStamp() {
  const d = new Date();
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  const cn = new Date(utcMs + 8 * 3600000);
  const p = n => String(n).padStart(2, '0');
  return `${cn.getFullYear()}-${p(cn.getMonth() + 1)}-${p(cn.getDate())}T${p(cn.getHours())}:${p(cn.getMinutes())}:${p(cn.getSeconds())}+08:00`;
}

function dumpJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
(async function main() {
  const sourcePath = path.join(ROOT, 'fnpack.json');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  const apps = source.apps || (source.apps = {});

  console.log(`正在扫描 ${OWNER} 的仓库...`);
  const repos = await api(`/users/${OWNER}/repos?per_page=100&sort=updated`);

  const added = [];
  const updated = [];
  const skipped = [];

  for (const repo of repos) {
    if (repo.name === SELF_REPO) continue;

    let releases;
    try {
      releases = await api(`/repos/${repo.full_name}/releases?per_page=100`);
    } catch (e) {
      console.log(`  [跳过] ${repo.name}：无法读取 releases（${e.message}）`);
      continue;
    }

    // 取最新一个（非草稿）且带 .fpk 资产的 Release
    let hit = null;
    for (const rel of releases) {
      if (rel.draft) continue;
      const asset = (rel.assets || []).find(a => /\.fpk$/i.test(a.name));
      if (asset) {
        hit = { rel, asset };
        break;
      }
    }
    if (!hit) continue;

    const { rel, asset } = hit;
    let digest = (asset.digest || '').replace(/^sha256:/i, '');

    let appname = null;
    let manifest = {};
    try {
      const buf = (await request(asset.browser_download_url)).body;
      const text = readFromTarGz(buf, ['manifest', 'manifest.json']);
      manifest = parseManifest(text);
      if (manifest.appname) {
        appname = manifest.appname;
      } else {
        // manifest 缺失时按文件名兜底
        appname = asset.name.replace(/-\d[\w.\-+]*\.fpk$/i, '');
      }
      // 优先用实际下载内容的哈希，其次用 Release 提供的 digest
      if (!digest) digest = sha256(buf);
    } catch (e) {
      console.log(`  [跳过] ${repo.name}：下载或解析 FPK 失败（${e.message}）`);
      continue;
    }

    const version = manifest.version || rel.tag_name.replace(/^v/, '');
    const detailRel = (apps[appname] && apps[appname].details_url) || `apps/${appname}.json`;
    const detailPath = path.join(ROOT, detailRel);

    let detail;
    if (fs.existsSync(detailPath)) {
      detail = JSON.parse(fs.readFileSync(detailPath, 'utf-8'));
    } else {
      // 新应用：图标优先取仓库内的 ICON_256.PNG，取不到用 GitHub 头像兜底
      let icon = `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/fnos/${appname}/ICON_256.PNG`;
      if (await head(icon) !== 200) {
        icon = `https://github.com/${OWNER}.png?size=256`;
      }
      const categories = CATEGORY_HINT[appname] || DEFAULT_CATEGORY;
      detail = {
        app_name: appname,
        display_name: manifest.display_name || appname,
        desc: manifest.desc || `${repo.name} 应用。`,
        platform: [manifest.platform || 'all'],
        categories,
        icon_url: icon,
        readme_url: `https://raw.githubusercontent.com/${repo.full_name}/${repo.default_branch}/README.md`,
        bug_report_url: `https://github.com/${repo.full_name}/issues`,
        maintainer: manifest.maintainer || OWNER,
        maintainer_url: manifest.maintainer_url || `https://github.com/${repo.full_name}`,
        distributor: OWNER,
        distributor_url: `https://github.com/${repo.full_name}`,
        run_as: 'package',
        install_type: '',
        is_docker: false,
        service_port: manifest.service_port || '',
        releases: {},
      };
      if (!CATEGORY_HINT[appname]) {
        console.log(`  [注意] ${appname} 无分类提示，暂归入「系统工具」，请手动调整 apps/${appname}.json`);
      }
    }

    const appReleases = detail.releases || (detail.releases = {});
    const prev = appReleases[version];
    const prevPkg = prev && prev.packages && prev.packages.all;
    let changed = false;
    if (prevPkg && prevPkg.sha256 && prevPkg.sha256 === digest) {
      skipped.push(`${appname} ${version}（无变化）`);
    } else {
      appReleases[version] = {
        changelog: manifest.changelog || rel.body || `更新到 ${version}。`,
        updated_at: localStamp(),
        os_min_version: manifest.os_min_version || '',
        packages: {
          all: {
            download_url: asset.browser_download_url,
            sha256: digest,
            size: asset.size,
          },
        },
      };
      (prev ? updated : added).push(`${appname} ${version}`);
      changed = true;
    }

    detail.display_name = detail.display_name || manifest.display_name || appname;
    if (manifest.service_port && !detail.service_port) detail.service_port = manifest.service_port;

    fs.mkdirSync(path.dirname(detailPath), { recursive: true });
    dumpJson(detailPath, detail);

    // 仅在首次注册或内容变化时刷新时间戳，避免每次运行都产生无意义的提交
    if (!apps[appname] || apps[appname].details_url !== detailRel) {
      apps[appname] = { details_url: detailRel, details_updated_at: localStamp() };
    } else if (changed) {
      apps[appname].details_updated_at = localStamp();
    }
    console.log(`  已处理 ${repo.name} -> ${appname} ${version}`);
  }

  dumpJson(sourcePath, source);

  console.log('');
  console.log(`新增应用 ${added.length} 个：${added.join('、') || '无'}`);
  console.log(`更新版本 ${updated.length} 个：${updated.join('、') || '无'}`);
  console.log(`无变化 ${skipped.length} 个：${skipped.join('、') || '无'}`);
  console.log('');
  console.log('下一步：运行 python scripts/validate.py 校验，再运行 推送.bat。');
})().catch(e => {
  console.error('[错误] 更新失败：' + (e && e.message));
  process.exit(1);
});
