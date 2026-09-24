/**
 * 从 GitHub 拉取：读取 .env 中的仓库地址与令牌，执行 git pull
 * 用法：node pull.js   （或双击 拉取.bat）
 *
 * @author RONGLINC <chenronglin1993@hotmail.com>
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = __dirname;

// 读取 .env 配置
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
const token = env.GITHUB_TOKEN || '';
const repoUrl = (env.GITHUB_REPO_URL || '').trim();
if (!repoUrl || !token) {
  console.error('[错误] .env 中缺少 GITHUB_REPO_URL 或 GITHUB_TOKEN');
  process.exit(1);
}
const authUrl = repoUrl.replace('https://', `https://x-access-token:${token}@`);
// 输出时隐藏令牌
const mask = (s) => s.split(token).join('******');

function git(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch (e) {
    console.error('[错误] git 命令执行失败：');
    console.error(mask(((e.stdout || '') + (e.stderr || '')).toString().trim()));
    process.exit(1);
  }
}

// 用 symbolic-ref 而不是 rev-parse，兼容仓库还没有任何提交的情况
const branch = git(['symbolic-ref', '--short', 'HEAD']);
console.log(`正在从 GitHub 拉取 ${branch} 分支...`);
try {
  execFileSync('git', ['pull', '--no-edit', authUrl, branch], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('拉取成功，已是最新代码');
} catch (e) {
  const out = ((e.stdout || '') + (e.stderr || '')).toString();
  console.error('[错误] 拉取失败：');
  console.error(mask(out.trim()));
  if (out.includes('conflict')) {
    console.error('提示：存在合并冲突，请解决冲突后执行 git commit，再重新推送');
  }
  process.exit(1);
}

// 拉取后校验远端应用源，仅提示不阻断
const r = spawnSync('python', ['scripts/validate.py'], { cwd: ROOT, stdio: 'inherit' });
if (!r.error && r.status !== 0) {
  console.error('[警告] 远端应用源校验未通过，请检查 fnpack.json');
}
