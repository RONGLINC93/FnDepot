#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回填 fnpack.json 与详情文件中安装包的 sha256 和 size。

只处理 download_url 指向仓库内实际文件的分支，远程地址保持原样。

用法:
    python scripts/sync_meta.py          # 回填全部
    python scripts/sync_meta.py --check  # 只检查是否缺失，不写回
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "fnpack.json"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def dump_json(path: Path, data: dict) -> None:
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def sync_releases(releases: dict, base_dir: Path, check_only: bool) -> int:
    changed = 0
    for _version, node in releases.items():
        if not isinstance(node, dict):
            continue
        packages = node.get("packages")
        if not isinstance(packages, dict):
            continue
        for _arch, pkg in packages.items():
            if not isinstance(pkg, dict):
                continue
            url = pkg.get("download_url")
            if not isinstance(url, str) or urlparse(url).scheme:
                continue
            local = (base_dir / url).resolve()
            if not local.is_file():
                continue
            size = local.stat().st_size
            sha = sha256_file(local)
            if pkg.get("size") != size or pkg.get("sha256") != sha:
                changed += 1
                if not check_only:
                    pkg["size"] = size
                    pkg["sha256"] = sha
    return changed


def sync_file(path: Path, check_only: bool) -> tuple[int, dict]:
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = 0

    apps = data.get("apps")
    if isinstance(apps, dict):
        for _name, node in apps.items():
            if not isinstance(node, dict):
                continue
            details = node.get("details_url")
            if isinstance(details, str) and details.strip() and not urlparse(details).scheme:
                detail_path = (path.parent / details).resolve()
                if detail_path.is_file():
                    n, detail = sync_file(detail_path, check_only)
                    changed += n
                    if not check_only and n:
                        dump_json(detail_path, detail)
                continue
            releases = node.get("releases")
            if isinstance(releases, dict):
                changed += sync_releases(releases, path.parent, check_only)

    inner = data.get("releases")
    if isinstance(inner, dict):
        changed += sync_releases(inner, path.parent, check_only)

    return changed, data


def main() -> int:
    check_only = "--check" in sys.argv
    changed, data = sync_file(SOURCE, check_only)
    if not check_only and changed:
        dump_json(SOURCE, data)

    action = "需要回填" if check_only else "已回填"
    print(f"{action} {changed} 个安装包的 size/sha256。")
    if check_only and changed:
        print("运行 `python scripts/sync_meta.py` 可自动写入。")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
