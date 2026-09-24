# FnDepot

飞牛 fnOS 第三方应用源（FnDepot 外部应用源 V2 规范）。

用户可在 FnDepot 客户端的「源管理 → 添加源」中填入本仓库地址：

```
https://github.com/RONGLINC93/FnDepot
```

或直接填 `fnpack.json` 的直链。

- 中文界面源名称：**我的应用源**
- 英文界面源名称：**RONGLINC93 App Source**

## 已收录应用

| 应用名 | 显示名 | 分类 | 版本 | 端口 |
| --- | --- | --- | --- | --- |
| `student-management-system` | 学生管理系统 | 教育学习 | 1.4.15 | 3000 |
| `umweb` | 音乐解锁 | 影音娱乐 | 1.10.8 | 9520 |
| `reminder` | 提醒 | 生活服务 | 1.0.3 | 9530 |

应用安装包以 GitHub Release 直链形式提供，元数据自动从各仓库 FPK 内的 `manifest` 同步。

## 目录结构

```
FnDepot/
|-- fnpack.json                 # 主源索引（必需，文件名不可更改）
|-- 推送.bat / 拉取.bat / 更新.bat   # 薄壳，分别调用同名 .js
|-- push.js / pull.js / update.js    # 推送 / 拉取 / 自动更新逻辑
|-- apps/                       # 应用详情文件（拆分模式）
|   `-- <appname>.json
|-- assets/
|   |-- icons/                  # 应用图标，建议 PNG/WebP，< 500KB
|   `-- previews/               # 预览图，单张 < 2MB，每应用最多 8 张
|-- packages/                   # 本仓库自托管的 FPK 安装包（可选）
|-- templates/
|   `-- app.template.json       # 详情文件模板
|-- scripts/
|   |-- validate.py             # 规范校验
|   |-- sync_meta.py            # 回填 sha256 / size
|   `-- addapp.py               # 新增应用或版本
|-- .env.example                # 凭证模板（复制为 .env 后填写）
`-- .github/workflows/validate.yml
```

## 首次使用

1. 复制 `.env.example` 为 `.env`，填入：
   - `GITHUB_REPO_URL`：本仓库地址，以 `.git` 结尾。
   - `GITHUB_TOKEN`：Fine-grained token，需具备 Contents 读写权限。
   - `.env` 已被 `.gitignore` 忽略，不会提交。
2. 保证已安装 `git`、`python`、`node`（双击 `.bat` 时自动调用）。

## 日常操作

| 操作 | 命令 | 说明 |
| --- | --- | --- |
| 自动更新 | 双击 `更新.bat` | 扫描账号下所有仓库的 Release，把带 `.fpk` 的应用同步进本源 |
| 校验 | `python scripts/validate.py` | 校验结构、必填字段、分类/平台/架构，核对 `size`/`sha256` |
| 推送 | 双击 `推送.bat` | 校验 → `git add -A` → 提交 → 推送当前分支 |
| 拉取 | 双击 `拉取.bat` | 拉取当前分支并校验一次 |
| 手动新增 | `python scripts/addapp.py --help` | 把本地 FPK 注册进本源 |

`更新.bat` 工作方式：读取 `.env` 用户名 → 遍历其仓库 Release → 下载 `.fpk` 解析包内 `manifest` 得到 `appname`/`version`/`display_name`/`service_port` 等 → 写入 `apps/<appname>.json` 并在 `fnpack.json` 注册，`sha256`/`size` 取自 Release 资产。已存在的应用只刷新版本与安装包，保留分类、图标等人工字段。

> 新应用分类需预先在 `update.js` 顶部的 `CATEGORY_HINT` 登记，否则归入「系统工具」并提示手动调整。

## 应用字段速查

| 字段 | 说明 |
| --- | --- |
| `display_name` / `desc` | 显示名称与简介，`desc` 支持 HTML |
| `platform` | `all` / `x86` / `arm` |
| `categories` | 只能取九个固定分类，最多两个：`影音娱乐、系统工具、编程开发、AI赋能、生活服务、智能智控、教育学习、游戏地带、硬件驱动` |
| `icon_url` | 图标地址，支持相对或绝对 URL |
| `run_as` | `package` 或 `root` |
| `install_type` | `""` 存储空间，`"root"` 系统空间 |
| `is_docker` | 是否 Docker 应用 |
| `service_port` | 默认服务端口，无端口填空字符串 |
| `releases.<version>.packages.<arch>` | 架构键只允许 `all` / `x86` / `arm`，需填 `download_url`、`sha256`、`size` |

应用名（即 `apps` 的键名）必须与 FPK manifest 的 `appname` 完全一致且区分大小写。

## 组织方式

- **拆分模式（本仓库采用）**：`fnpack.json` 只保留索引，每个应用一个 `apps/<appname>.json`，详情内的相对 URL 相对该文件所在目录解析。
- **单文件模式**：所有应用信息直接写在 `fnpack.json` 的 `apps` 中，适合应用很少的源。

## 脚本参考

| 命令 | 作用 |
| --- | --- |
| `python scripts/validate.py` | 校验顶层结构、必填字段、分类/平台/架构合法性，并核对本地 FPK 的 `size`、`sha256` |
| `python scripts/sync_meta.py` | 自动回填仓库内安装包的 `size` 与 `sha256` |
| `python scripts/sync_meta.py --check` | 只检查是否缺失，不写回（CI 用） |
| `python scripts/addapp.py --help` | 新增应用或新版本 |
| `node update.js` | 自动扫描账号仓库 Release，同步应用源 |
| `node push.js [提交说明]` | 校验并提交推送 |
| `node pull.js` | 拉取远端并校验 |

## 发布前检查

- [ ] `schema_version` 为字符串 `"2"`，`source_info.name` / `author` 非空
- [ ] `fnpack.json` 是严格 JSON，无注释、无尾逗号
- [ ] 应用名与 FPK manifest 的 `appname` 一致
- [ ] `categories` 只使用九个固定分类
- [ ] 每个目标架构都有 `all` 或对应架构包
- [ ] `size` 等于实际字节数，`sha256` 与文件一致
- [ ] `python scripts/validate.py` 无错误输出

## 注意

- 发布新版本请在 `releases` 下新增版本键，不要静默替换已发布的 FPK。
- 移除应用请直接从 `apps` 中删除键，下次同步后客户端会清理缓存。
- 不要把 `source_info.author` 写进应用的 `maintainer`，除非两者确实是同一主体。
