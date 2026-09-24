/**
 * 推送到 GitHub：读取 .env 中的仓库地址与令牌，自动 add/commit/push
 * 推送前会先执行 scripts/validate.py 校验应用源（未安装 python 时跳过）
 * 用法：node push.js [提交说明]   （或双击 推送.bat）
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

// 校验应用源，python 不可用时只提示不阻断
function validateSource() {
  const r = spawnSync('python', ['scripts/validate.py'], { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.error) {
    console.log('[提示] 未检测到 python，跳过应用源校验');
    return;
  }
  if (r.status !== 0) {
    console.error('[错误] 应用源校验未通过，请先修复 fnpack.json 后再推送');
    process.exit(1);
  }
}

validateSource();

// 用 symbolic-ref 而不是 rev-parse，兼容仓库还没有任何提交的情况
const branch = git(['symbolic-ref', '--short', 'HEAD']);
const status = git(['status', '--porcelain']);

if (status) {
  const msg = process.argv.slice(2).join(' ') || `更新应用源 ${new Date().toLocaleString('zh-CN')}`;
  git(['add', '-A']);
  git(['commit', '-m', msg]);
  console.log('已提交改动：' + msg);
} else {
  console.log('没有未提交的本地改动，直接同步远端');
}

console.log(`正在推送 ${branch} 分支到 GitHub...`);
try {
  execFileSync('git', ['push', authUrl, branch], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  // 刷新远程跟踪引用，保证 git status 的领先/落后显示准确
  // 仓库可能没有名为 origin 的 remote，这里直接用带令牌的地址，失败也不影响推送结果
  try {
    execFileSync('git', ['fetch', authUrl, branch], { cwd: ROOT, stdio: 'ignore' });
  } catch (_) { /* 忽略 fetch 失败 */ }
  console.log('推送成功');
} catch (e) {
  const out = ((e.stdout || '') + (e.stderr || '')).toString();
  console.error('[错误] 推送失败：');
  console.error(mask(out.trim()));
  if (out.includes('rejected')) {
    console.error('提示：远端有新提交，请先运行 拉取.bat 同步后再推送');
  }
  process.exit(1);
}
