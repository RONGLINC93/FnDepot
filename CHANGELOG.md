# Changelog

本文件记录 **FnDepot 应用源仓库**本身的变更。每个应用自身的版本更新日志见其
`apps/<appname>.json` 中 `releases.<version>.changelog` 字段，`更新.bat` 会自动
从各仓库 FPK 的 manifest 或 Release 说明回填该字段。

## [2026-09-24]

### 新增
- 仓库骨架：`fnpack.json`（外部应用源 V2 规范）、`apps/`、`assets/`、`packages/`、`templates/`。
- 校验与维护脚本：`scripts/validate.py`（规范与 size/sha256 校验）、`scripts/sync_meta.py`（回填
  size/sha256）、`scripts/addapp.py`（新增应用或版本）、`.github/workflows/validate.yml`（CI 校验）。
- 推送 / 拉取：`推送.bat`、`拉取.bat`（薄壳 + `push.js` / `pull.js`，仓库地址与令牌读自 `.env`）。
- 自动更新：`更新.bat`、`update.js`，扫描 GitHub 账号下各仓库 Release 的 `.fpk`，解析包内
  `manifest` 后自动同步进本源（保留分类、图标等人工字段）。
- 接入首批应用：`student-management-system` 1.4.15（教育学习）、`umweb` 1.10.8（影音娱乐）、
  `reminder` 1.0.3（生活服务），安装包以 GitHub Release 直链提供。

### 修复 / 改动
- 修正英文源名称：`My App Source` → `RONGLINC93 App Source`。
- `push.js` 在仓库无 `origin` remote 时不再误报失败（fetch 改用带令牌地址并忽略失败）。
- 完善 `README.md`（已收录应用清单、目录结构、脚本与字段速查、发布前检查）。
