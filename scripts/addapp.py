#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""向应用源新增应用或新版本（拆分详情模式）。

会复制 FPK/图标到仓库、计算 sha256 与 size、生成 apps/<name>.json，
并在 fnpack.json 中注册。

示例:
    python scripts/addapp.py --name sample.app --display "示例应用" \
        --desc "一句话简介" --category 系统工具 --version 1.0.0 \
        --fpk D:/downloads/sample.fpk --icon D:/downloads/icon.png --port 8080
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fnpack.json"
APPS_DIR = ROOT / "apps"
PKGS_DIR = ROOT / "packages"
ICON_DIR = ROOT / "assets" / "icons"

CATEGORIES = [
    "影音娱乐", "系统工具", "编程开发", "AI赋能",
    "生活服务", "智能智控", "教育学习", "游戏地带", "硬件驱动",
]
APPNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# 固定使用中国时区（Asia/Shanghai, +08:00），避免依赖运行机器的本地时区
_CN_TZ = timezone(timedelta(hours=8))


def local_stamp() -> str:
    return datetime.now(_CN_TZ).strftime("%Y-%m-%dT%H:%M:%S+08:00")


def dump_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_into(src: Path, dest: Path) -> Path:
    if src.resolve() == dest.resolve():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return dest


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="向 FnDepot 应用源新增应用或版本")
    p.add_argument("--name", required=True, help="应用名，须与 FPK manifest 的 appname 一致")
    p.add_argument("--display", required=True, help="显示名称")
    p.add_argument("--desc", required=True, help="应用简介")
    p.add_argument("--category", action="append", default=[], choices=CATEGORIES, help="分类，最多两个，可重复传入")
    p.add_argument("--platform", action="append", default=[], choices=["all", "x86", "arm"], help="适用平台，默认 all")
    p.add_argument("--version", required=True, help="版本号，如 1.0.0")
    p.add_argument("--arch", default="all", choices=["all", "x86", "arm"], help="安装包架构，默认 all")
    p.add_argument("--fpk", required=True, help="FPK 文件本地路径")
    p.add_argument("--icon", help="图标文件本地路径")
    p.add_argument("--port", default="", help="默认服务端口，无端口留空")
    p.add_argument("--maintainer", default="", help="开发者或团队名称")
    p.add_argument("--maintainer-url", default="", help="开发者网站或联系方式")
    p.add_argument("--distributor", default="", help="发布者名称，与开发者不同才填")
    p.add_argument("--distributor-url", default="")
    p.add_argument("--changelog", default="", help="版本更新说明")
    p.add_argument("--docker", action="store_true", help="标记为 Docker 应用")
    p.add_argument("--root", action="store_true", help="以 root 运行")
    p.add_argument("--system-space", action="store_true", help="安装到系统空间（install_type=root）")
    return p.parse_args()


def main() -> int:
    args = parse_args()

    if not APPNAME_RE.match(args.name):
        print(f"[错误] 应用名非法：{args.name}")
        return 1
    if len(args.category) > 2:
        print("[错误] categories 最多填写两个")
        return 1

    fpk_src = Path(args.fpk).expanduser()
    if not fpk_src.is_file():
        print(f"[错误] FPK 文件不存在：{fpk_src}")
        return 1

    package_name = f"{args.name}-{args.version}-{args.arch}.fpk"
    fpk_dest = copy_into(fpk_src, PKGS_DIR / package_name)

    icon_rel = ""
    if args.icon:
        icon_src = Path(args.icon).expanduser()
        if not icon_src.is_file():
            print(f"[错误] 图标文件不存在：{icon_src}")
            return 1
        icon_dest = copy_into(icon_src, ICON_DIR / f"{args.name}{icon_src.suffix}")
        icon_rel = "../assets/icons/" + icon_dest.name

    package = {
        "download_url": "../packages/" + fpk_dest.name,
        "sha256": sha256_file(fpk_dest),
        "size": fpk_dest.stat().st_size,
    }

    APPS_DIR.mkdir(parents=True, exist_ok=True)
    detail_path = APPS_DIR / f"{args.name}.json"
    detail: dict
    if detail_path.is_file():
        detail = json.loads(detail_path.read_text(encoding="utf-8"))
        detail["display_name"] = args.display
        detail["desc"] = args.desc
        if icon_rel:
            detail["icon_url"] = icon_rel
        releases = detail.setdefault("releases", {})
        version_node = releases.setdefault(args.version, {})
        if args.changelog:
            version_node["changelog"] = args.changelog
        version_node["updated_at"] = local_stamp()
        version_node.setdefault("packages", {})[args.arch] = package
    else:
        detail = {
            "app_name": args.name,
            "display_name": args.display,
            "desc": args.desc,
            "platform": args.platform or ["all"],
            "categories": args.category or ["系统工具"],
            "icon_url": icon_rel,
            "maintainer": args.maintainer,
            "maintainer_url": args.maintainer_url,
            "distributor": args.distributor,
            "distributor_url": args.distributor_url,
            "run_as": "root" if args.root else "package",
            "install_type": "root" if args.system_space else "",
            "is_docker": bool(args.docker),
            "service_port": args.port,
            "releases": {
                args.version: {
                    "changelog": args.changelog or "首个版本。",
                    "updated_at": local_stamp(),
                    "packages": {args.arch: package},
                }
            },
        }
    dump_json(detail_path, detail)

    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    apps = source.setdefault("apps", {})
    apps[args.name] = {
        "details_url": f"apps/{args.name}.json",
        "details_updated_at": local_stamp(),
    }
    dump_json(SOURCE, source)

    print(f"已写入 {detail_path}")
    print(f"已注册 {args.name} {args.version} [{args.arch}] -> {SOURCE}")
    print("下一步：运行 python scripts/validate.py 校验。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
