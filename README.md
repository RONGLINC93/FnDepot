# FnDepot

飞牛 fnOS 第三方应用源（FnDepot 外部应用源 V2 规范）。

用户可在 FnDepot 客户端的「源管理 → 添加源」中填入本仓库地址：

```
https://github.com/<你的用户名>/FnDepot
```

或直接填 `fnpack.json` 的直链。

## 目录结构

```
FnDepot/
|-- fnpack.json                 # 主源索引（必需，文件名不可更改）
|-- apps/                       # 应用详情文件（拆分模式）
|   `-- <appname>.json
|-- assets/
|   |-- icons/                  # 应用图标，建议 PNG/WebP，< 500KB
|   `-- previews/               # 预览图，单张 < 2MB，每应用最多 8 张
|-- packages/                   # FPK 安装包
|   `-- <appname>-<version>-<arch>.fpk
|-- templates/
|   `-- app.template.json       # 详情文件模板
|-- scripts/
|   |-- validate.py             # 规范校验
|   |-- sync_meta.py            # 回填 sha256 / size
|   `-- addapp.py               # 新增应用或版本
`-- .github/workflows/validate.yml
```

## 快速开始

1. 修改 `fnpack.json` 中的 `source_info`（`name`、`author`、`homepage`）。
2. 放入你的 FPK 并注册应用：

   ```powershell
   python scripts/addapp.py --name sample.app --display "示例应用" `
       --desc "一句话简介" --category 系统工具 --version 1.0.0 `
       --fpk D:\downloads\sample.fpk --icon D:\downloads\icon.png --port 8080
   ```

3. 校验并推送：

   ```powershell
   python scripts/validate.py
   git add -A && git commit -m "feat: add sample.app 1.0.0" && git push
   ```

## 应用字段速查

| 字段 | 说明 |
| --- | --- |
| `display_name` / `desc` | 显示名称与简介，`desc` 支持 HTML |
| `platform` | `all` / `x86` / `arm` |
| `categories` | 只能取九个固定分类，最多两个：`影音娱乐、系统工具、编程开发、AI赋能、生活服务、智能智控、教育学习、游戏地带、硬件驱动` |
| `icon_url` | 图标地址，支持相对路径 |
| `run_as` | `package` 或 `root` |
| `install_type` | `""` 存储空间，`"root"` 系统空间 |
| `is_docker` | 是否 Docker 应用 |
| `service_port` | 默认服务端口，无端口填空字符串 |
| `releases.<version>.packages.<arch>` | 架构键只允许 `all` / `x86` / `arm`，需填 `download_url`、`sha256`、`size` |

应用名（也就是 `apps` 的键名）必须与 FPK manifest 的 `appname` 完全一致且区分大小写。

## 两种组织方式

- **单文件模式**：所有应用信息直接写在 `fnpack.json` 的 `apps` 中，适合应用很少的源。
- **拆分模式（推荐）**：`fnpack.json` 只保留索引，每个应用一个 `apps/<appname>.json`。详情文件中的相对 URL 相对详情文件所在目录解析，本仓库模板已按此处理（`../packages/...`）。

## 推送与拉取

首次使用：复制 `.env.example` 为 `.env`，填入 `GITHUB_REPO_URL` 与 `GITHUB_TOKEN`（Fine-grained token，需 Contents 读写权限）。`.env` 已被 `.gitignore` 忽略。

- 双击 `推送.bat`（或 `node push.js "提交说明"`）：校验应用源 → `git add -A` → 提交 → 推送当前分支。
- 双击 `拉取.bat`（或 `node pull.js`）：从远端拉取当前分支，随后校验一次应用源。

提交说明省略时自动使用「更新应用源 + 当前时间」。推送被拒时先运行 `拉取.bat` 同步再推送。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `python scripts/validate.py` | 校验顶层结构、必填字段、分类/平台/架构合法性，并核对本地 FPK 的 `size`、`sha256` |
| `python scripts/sync_meta.py` | 自动回填仓库内安装包的 `size` 与 `sha256` |
| `python scripts/sync_meta.py --check` | 只检查是否缺失，不写回（CI 用） |
| `python scripts/addapp.py --help` | 新增应用或新版本 |

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
