#!/usr/bin/env python3
"""发布 FloatLyric 到 GitHub Releases，保证中文不乱码。

为什么需要它：在 Windows 的 Git Bash 或 cmd 里用 curl 的 -d / --data 传中文，
命令行参数会按 cp936 交给 curl，GitHub 收到后整段变成问号（标题和正文都是）。
这个脚本全程按 UTF-8 读写，并在发出去之前自检有没有问号，只有标准库依赖。

用法（Token 需要 repo 权限）：

    # Git Bash
    GITHUB_TOKEN=ghp_xxx python tools/release.py --dry-run
    GITHUB_TOKEN=ghp_xxx python tools/release.py

    # PowerShell
    $env:GITHUB_TOKEN="ghp_xxx"; python tools/release.py --dry-run

--dry-run 只打印将要提交的标题与正文，不调用任何写接口。
发布前会先跑一次 npm run dist 生成 dist/FloatLyric-<版本>-portable.exe。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OWNER_REPO = "YardonYan/FloatLyric"
API = "https://api.github.com"
PREAMBLE = "Windows 10 / 11 + 桌面版网易云音乐客户端。下载后双击即可，无需安装。"
FOOTER = (
    "首次使用请在面板点一次「以调试模式启动网易云」，详见 "
    "[README](https://github.com/YardonYan/FloatLyric#第一次连接网易云)。"
    "完整变更见 [CHANGELOG.md](https://github.com/YardonYan/FloatLyric/blob/main/CHANGELOG.md)。"
)


def version() -> str:
    return json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]


def changelog_section(ver: str) -> str:
    """从 CHANGELOG.md 取出指定版本的段落，转成 Release 正文的格式。"""
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    m = re.search(rf"^## {re.escape(ver)}.*?$(.*?)(?=^## |\Z)", text, re.M | re.S)
    if not m:
        raise SystemExit(f"CHANGELOG.md 里找不到 {ver} 的段落，先补更新日志再发布")
    body = m.group(1).strip()
    # ### 新增 -> **新增**
    body = re.sub(r"^### (.+)$", r"**\1**", body, flags=re.M)
    return body


def digest(path: Path) -> tuple[int, str]:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return path.stat().st_size, h.hexdigest()


def build_body(ver: str, asset: Path) -> str:
    size, sha = digest(asset)
    return "\n".join(
        [
            PREAMBLE,
            "",
            changelog_section(ver),
            "",
            f"文件：{asset.name}（{size:,} 字节）",
            f"SHA-256：{sha}",
            "",
            FOOTER,
        ]
    )


def check_no_mojibake(title: str, body: str) -> None:
    """发之前自检：中文被按 cp936 传坏时会留下连续的问号。"""
    for label, text in (("标题", title), ("正文", body)):
        if re.search(r"\?{3,}", text):
            raise SystemExit(f"{label}里有连续问号，疑似编码已坏，中止")
        if "?? " in text:
            raise SystemExit(f"{label}里出现 '?? '，疑似编码已坏，中止")


def api(method: str, path: str, token: str, payload: dict | None = None):
    data = None
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "floatlyric-release",
    }
    if payload is not None:
        # 关键：ensure_ascii=False + 显式 UTF-8，避免被本地代码页改写
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:400]
        raise SystemExit(f"{method} {path} 失败：HTTP {e.code} {detail}")


def upload_asset(release: dict, asset: Path, token: str) -> None:
    upload_url = re.sub(r"\{.*\}$", "", release["upload_url"])
    boundary = "----FloatLyricReleaseBoundary"
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{asset.name}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    data = head + asset.read_bytes() + tail
    req = urllib.request.Request(
        f"{upload_url}?name={asset.name}",
        data=data,
        method="POST",
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "floatlyric-release",
        },
    )
    with urllib.request.urlopen(req, timeout=600) as r:
        got = json.load(r)
        print(f"  上传完成：{got['name']}（{got['size']:,} 字节）")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只打印将要提交的内容")
    args = ap.parse_args()

    ver = version()
    tag = f"v{ver}"
    title = f"{tag} · 浮词 FloatLyric"
    asset = ROOT / "dist" / f"FloatLyric-{ver}-portable.exe"
    if not asset.exists():
        raise SystemExit(f"找不到产物 {asset}，先跑 npm run dist")

    body = build_body(ver, asset)
    check_no_mojibake(title, body)

    if args.dry_run:
        print(f"tag   : {tag}")
        print(f"title : {title}")
        print(f"asset : {asset.name}")
        print("-" * 60)
        print(body)
        return

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        raise SystemExit("缺 GITHUB_TOKEN 环境变量")

    existing = api("GET", f"/repos/{OWNER_REPO}/releases/tags/{tag}", token) if _tag_exists(token, tag) else None
    if existing:
        rel = api("PATCH", f"/repos/{OWNER_REPO}/releases/{existing['id']}", token,
                  {"name": title, "body": body})
        print(f"已更新既有 Release {tag}")
    else:
        rel = api("POST", f"/repos/{OWNER_REPO}/releases", token,
                  {"tag_name": tag, "name": title, "body": body, "draft": False})
        print(f"已创建 Release {tag}")

    names = {a["name"] for a in rel.get("assets", [])}
    if asset.name in names:
        print(f"  产物已存在，跳过上传：{asset.name}")
    else:
        upload_asset(rel, asset, token)

    # 回读确认，防止接口返回成功但内容已坏
    back = api("GET", f"/repos/{OWNER_REPO}/releases/tags/{tag}", token)
    check_no_mojibake(back.get("name") or "", back.get("body") or "")
    print(f"回读校验通过：{back['name']}")
    print(f"链接：{back['html_url']}")


def _tag_exists(token: str, tag: str) -> bool:
    try:
        api("GET", f"/repos/{OWNER_REPO}/releases/tags/{tag}", token)
        return True
    except SystemExit:
        return False


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
