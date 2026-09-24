#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FnDepot 外部应用源 V2 校验脚本。

用法:
    python scripts/validate.py                 # 校验仓库根目录的 fnpack.json
    python scripts/validate.py path/to.json    # 校验指定源文件

检查项: 顶层结构、source_info、应用字段、分类/平台/架构合法性、
       版本与安装包、URL 协议、sha256 与 size 是否与本地文件一致。
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

CATEGORIES = {
    "影音娱乐", "系统工具", "编程开发", "AI赋能",
    "生活服务", "智能智控", "教育学习", "游戏地带", "硬件驱动",
}
PLATFORMS = {"all", "x86", "arm"}
ARCHES = {"all", "x86", "arm"}
RUN_AS = {"package", "root"}
INSTALL_TYPE = {"", "root"}
APPNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
HEX64_RE = re.compile(r"^[0-9a-fA-F]{64}$")


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, scope: str, msg: str) -> None:
        self.errors.append(f"[错误] {scope}: {msg}")

    def warn(self, scope: str, msg: str) -> None:
        self.warnings.append(f"[警告] {scope}: {msg}")

    def ok(self) -> bool:
        return not self.errors


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def valid_url(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    scheme = urlparse(value).scheme
    if scheme:
        return scheme in ("http", "https")
    return True  # 相对 URL 合法


def resolve_local(base_dir: Path, url: str) -> Path | None:
    """相对 URL 按仓库实际布局解析成本地文件，找不到返回 None。"""
    if urlparse(url).scheme:
        return None
    path = (base_dir / url).resolve()
    return path if path.is_file() else None


def check_package(scope: str, pkg: object, base_dir: Path, report: Report) -> None:
    if not isinstance(pkg, dict):
        report.error(scope, "安装包分支必须是对象")
        return

    url = pkg.get("download_url")
    if not isinstance(url, str) or not url.strip():
        report.error(scope, "缺少 download_url")
        return
    if not valid_url(url):
        report.error(scope, f"download_url 只允许 http/https 或相对路径: {url}")

    sha = pkg.get("sha256")
    if sha is None:
        report.warn(scope, "未填写 sha256，客户端将无法校验完整性")
    elif not (isinstance(sha, str) and HEX64_RE.match(sha)):
        report.error(scope, "sha256 必须是 64 位十六进制字符串")

    size = pkg.get("size")
    if size is None:
        report.warn(scope, "未填写 size，建议补充")
    elif not (isinstance(size, int) and not isinstance(size, bool) and size >= 0):
        report.error(scope, "size 必须是非负整数（单位：字节）")

    local = resolve_local(base_dir, url)
    if local is None:
        if not urlparse(url).scheme:
            report.warn(scope, f"相对路径在本地不存在，跳过哈希校验: {url}")
        return

    actual_size = local.stat().st_size
    actual_sha = sha256_file(local)
    if isinstance(size, int) and size != actual_size:
        report.error(scope, f"size 不一致，JSON={size} 实际={actual_size}")
    if isinstance(sha, str) and HEX64_RE.match(sha) and sha.lower() != actual_sha:
        report.error(scope, f"sha256 不一致，JSON={sha.lower()} 实际={actual_sha}")


def check_releases(scope: str, releases: object, base_dir: Path, report: Report) -> None:
    if not isinstance(releases, dict) or not releases:
        report.error(scope, "releases 必须是非空对象")
        return
    if len(releases) > 100:
        report.error(scope, "单个应用最多 100 个版本")

    for version, node in releases.items():
        v_scope = f"{scope} 版本 {version}"
        if not isinstance(node, dict):
            report.error(v_scope, "版本节点必须是对象")
            continue
        if not re.match(r"^[0-9][0-9A-Za-z.\-+]*$", str(version)):
            report.warn(v_scope, "版本号建议使用 SemVer，且不要使用 latest 或日期文字")

        packages = node.get("packages")
        if not isinstance(packages, dict) or not packages:
            report.error(v_scope, "packages 必须是非空对象")
            continue
        for arch, pkg in packages.items():
            if arch not in ARCHES:
                report.error(v_scope, f"非法架构键 '{arch}'，只允许 all/x86/arm")
                continue
            check_package(f"{v_scope} 包 {arch}", pkg, base_dir, report)


def check_app(name: str, node: object, base_dir: Path, report: Report) -> None:
    scope = f"应用 {name}"
    if not APPNAME_RE.match(name):
        report.error(scope, "应用名只允许字母、数字、点、下划线、短横线，且以字母或数字开头")
    if not isinstance(node, dict):
        report.error(scope, "应用节点必须是对象")
        return

    details_url = node.get("details_url")
    if isinstance(details_url, str) and details_url.strip():
        if not valid_url(details_url):
            report.error(scope, f"details_url 协议非法: {details_url}")
            return
        detail_path = resolve_local(base_dir, details_url)
        if detail_path is None:
            report.warn(scope, f"详情文件在本地不存在，跳过详情校验: {details_url}")
            return
        try:
            detail = json.loads(detail_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            report.error(scope, f"详情文件不是合法 JSON: {exc}")
            return
        if not isinstance(detail, dict):
            report.error(scope, "详情文件根节点必须是对象")
            return
        if detail.get("app_name") != name:
            report.error(scope, f"详情文件 app_name 必须为 '{name}'，实际为 '{detail.get('app_name')}'")
            return
        merged = dict(node)
        merged.update(detail)
        check_app_fields(scope, merged, detail_path.parent, report)
        return

    check_app_fields(scope, node, base_dir, report)


def check_app_fields(scope: str, app: dict, base_dir: Path, report: Report) -> None:
    for field in ("display_name", "desc", "icon_url"):
        value = app.get(field)
        if not isinstance(value, str) or not value.strip():
            report.error(scope, f"缺少必填字段 {field}")
        elif field == "icon_url" and not valid_url(value):
            report.error(scope, f"icon_url 协议非法: {value}")

    platforms = app.get("platform")
    if platforms is None:
        report.error(scope, "缺少必填字段 platform")
    else:
        items = [platforms] if isinstance(platforms, str) else platforms
        if not isinstance(items, list) or not items:
            report.error(scope, "platform 必须是字符串或非空字符串数组")
        else:
            for p in items:
                if p not in PLATFORMS:
                    report.error(scope, f"非法 platform '{p}'，只允许 all/x86/arm")

    categories = app.get("categories")
    if not isinstance(categories, list) or not categories:
        report.error(scope, "缺少必填字段 categories")
    else:
        if len(categories) > 2:
            report.error(scope, "categories 最多填写两个")
        for c in categories:
            if c not in CATEGORIES:
                report.error(scope, f"非法分类 '{c}'，只允许九个固定分类")

    run_as = app.get("run_as")
    if run_as is None:
        report.error(scope, "缺少必填字段 run_as")
    elif run_as not in RUN_AS:
        report.error(scope, "run_as 只允许 package 或 root")

    install_type = app.get("install_type")
    if install_type is None:
        report.error(scope, "缺少必填字段 install_type（空字符串表示存储空间）")
    elif install_type not in INSTALL_TYPE:
        report.error(scope, "install_type 只允许 '' 或 'root'")

    is_docker = app.get("is_docker")
    if is_docker is None:
        report.error(scope, "缺少必填字段 is_docker")
    elif not isinstance(is_docker, bool):
        report.error(scope, "is_docker 必须是布尔值")

    for field in ("preview_urls",):
        value = app.get(field)
        if value is not None:
            if not isinstance(value, list):
                report.error(scope, f"{field} 必须是数组")
            elif len(value) > 8:
                report.warn(scope, "预览图最多读取前 8 张")

    releases = app.get("releases")
    if releases is None:
        report.error(scope, "单文件模式必须提供 releases")
    else:
        check_releases(scope, releases, base_dir, report)


def validate(source_path: Path) -> Report:
    report = Report()
    base_dir = source_path.parent

    try:
        data = json.loads(source_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        report.error("源文件", f"找不到 {source_path}")
        return report
    except json.JSONDecodeError as exc:
        report.error("源文件", f"不是合法 JSON（不得包含注释或尾逗号）: {exc}")
        return report

    if not isinstance(data, dict):
        report.error("源文件", "根节点必须是对象")
        return report

    if data.get("schema_version") != "2":
        report.error("源文件", "schema_version 必须是字符串 \"2\"")

    info = data.get("source_info")
    if not isinstance(info, dict):
        report.error("source_info", "缺失或不是对象")
    else:
        for field in ("name", "author"):
            value = info.get(field)
            if not isinstance(value, str) or not value.strip():
                report.error("source_info", f"缺少必填字段 {field}")

    apps = data.get("apps")
    if not isinstance(apps, dict):
        report.error("apps", "缺失或不是对象")
        return report

    if not apps:
        report.warn("apps", "当前源没有任何应用，客户端将显示空列表")
    if len(apps) > 5000:
        report.error("apps", "单个源最多 5000 个应用")

    for name, node in apps.items():
        check_app(str(name), node, base_dir, report)

    return report


def main() -> int:
    arg = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    source_path = arg / "fnpack.json" if arg.is_dir() else arg

    report = validate(source_path)
    print(f"校验文件: {source_path}")

    if not report.errors and not report.warnings:
        print("校验通过：未发现问题。")
        return 0

    for line in report.warnings:
        print(line)
    for line in report.errors:
        print(line)

    print(f"\n共 {len(report.errors)} 个错误，{len(report.warnings)} 个警告。")
    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
