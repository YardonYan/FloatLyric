# -*- coding: utf-8 -*-
"""Regenerate the two SVG illustrations used by README.md / README.en.md.

Zero dependencies, standard library only:

    python tools/gen_readme_images.py

The script is the single source of truth for these images. Edit it, re-run it,
commit both the script and the SVGs. Do not hand-edit the generated files.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

FONT = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', "
        "'Microsoft YaHei', 'PingFang SC', sans-serif")
INK = "#243044"
MUTED = "#5A6678"

LYRIC = "等午夜再唤醒我自己"


def card(x, y, w, label, styled):
    """One mock document window with a lyric line embedded in the body text."""
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="300" rx="14" '
        f'fill="#FFFFFF" stroke="#D9E0EA" stroke-width="1.5"/>',
        f'<circle cx="{x + 26}" cy="{y + 26}" r="5" fill="#FF5F57"/>',
        f'<circle cx="{x + 44}" cy="{y + 26}" r="5" fill="#FEBC2E"/>',
        f'<circle cx="{x + 62}" cy="{y + 26}" r="5" fill="#28C840"/>',
        f'<rect x="{x + 92}" y="{y + 19}" width="118" height="14" rx="7" fill="#EEF2F7"/>',
        f'<line x1="{x}" y1="{y + 50}" x2="{x + w}" y2="{y + 50}" '
        f'stroke="#EDF1F6" stroke-width="1.5"/>',
    ]
    widths = [410, 372, 440, 0, 396, 348]
    top = y + 76
    for i, width in enumerate(widths):
        if not width:
            continue
        out.append(f'<rect x="{x + 32}" y="{top + i * 34}" width="{width}" '
                   f'height="10" rx="5" fill="#E3E8EF"/>')

    lyric_y = top + 3 * 34
    if styled:
        out.append(f'<rect x="{x + 20}" y="{lyric_y - 15}" width="{w - 40}" '
                   f'height="54" rx="13" fill="#3B434F"/>')
        out.append(f'<text x="{x + 40}" y="{lyric_y + 24}" font-family="{FONT}" '
                   f'font-size="26" font-weight="600" fill="none" stroke="#FFFFFF" '
                   f'stroke-opacity="0.30" stroke-width="7">{LYRIC}</text>')
        out.append(f'<text x="{x + 40}" y="{lyric_y + 24}" font-family="{FONT}" '
                   f'font-size="26" font-weight="600" fill="#FFFFFF">{LYRIC}</text>')
    else:
        out.append(f'<text x="{x + 32}" y="{lyric_y + 24}" font-family="{FONT}" '
                   f'font-size="26" font-weight="400" fill="#3D434B">{LYRIC}</text>')

    out.append(f'<text x="{x + w / 2}" y="{y + 336}" text-anchor="middle" '
               f'font-family="{FONT}" font-size="18" font-weight="600" '
               f'fill="{INK}">{label}</text>')
    return "\n    ".join(out)


def hero():
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 410" width="1200" height="410" role="img" aria-label="同一句歌词的两种外观：默认是一行裸文字，调高底色与光晕后出现色块和柔光">
  <rect width="1200" height="410" fill="#F6F8FB"/>
    {card(48, 34, 536, "默认 · 一行裸文字", False)}
    {card(616, 34, 536, "底色与光晕调高后", True)}
  <text x="600" y="398" text-anchor="middle" font-family="{FONT}" font-size="15" fill="{MUTED}">同一句歌词的两种外观。颜色、深浅、字号、底色浓度与光晕均由面板连续调节，0 即完全关闭。</text>
</svg>
"""


def node(x, y, w, h, fill, stroke, title, subtitle):
    return "\n    ".join([
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
        f'fill="{fill}" stroke="{stroke}" stroke-width="1.5"/>',
        f'<text x="{x + w / 2}" y="{y + 44}" text-anchor="middle" '
        f'font-family="{FONT}" font-size="18" font-weight="700" fill="{INK}">{title}</text>',
        f'<text x="{x + w / 2}" y="{y + 72}" text-anchor="middle" '
        f'font-family="{FONT}" font-size="13" fill="{MUTED}">{subtitle}</text>',
    ])


def arrow(x1, x2, y):
    tip = x2 - 9
    return "\n    ".join([
        f'<line x1="{x1}" y1="{y}" x2="{tip}" y2="{y}" stroke="#9AA8BC" stroke-width="2"/>',
        f'<polygon points="{tip},{y - 6} {tip},{y + 6} {x2},{y}" fill="#9AA8BC"/>',
    ])


def chip(x, y, w, text):
    return "\n    ".join([
        f'<rect x="{x}" y="{y}" width="{w}" height="42" rx="10" '
        f'fill="#FFFFFF" stroke="#DCE3ED" stroke-width="1.5"/>',
        f'<text x="{x + w / 2}" y="{y + 27}" text-anchor="middle" '
        f'font-family="{FONT}" font-size="14" fill="{INK}">{text}</text>',
    ])


def group(x, y, w, title, chips, note, link_to):
    out = [
        f'<rect x="{x}" y="{y}" width="{w}" height="176" rx="12" '
        f'fill="#FBFCFE" stroke="#E2E8F0" stroke-width="1.5" stroke-dasharray="6 5"/>',
        f'<text x="{x + 22}" y="{y + 32}" font-family="{FONT}" font-size="16" '
        f'font-weight="700" fill="{INK}">{title}</text>',
        f'<line x1="{link_to}" y1="{y}" x2="{link_to}" y2="{y - 26}" '
        f'stroke="#B7C4D6" stroke-width="1.5" stroke-dasharray="5 5"/>',
    ]
    step = (w - 44) // len(chips)
    for i, text in enumerate(chips):
        out.append(chip(x + 22 + i * step, y + 58, step - 12, text))
    out.append(f'<text x="{x + 22}" y="{y + 146}" font-family="{FONT}" '
               f'font-size="13" fill="{MUTED}">{note}</text>')
    return "\n    ".join(out)


def architecture():
    y, h, w = 58, 100, 250
    xs = [28, 322, 616, 910]
    parts = [
        '<rect width="1200" height="460" fill="#FFFFFF"/>',
        node(xs[0], y, w, h, "#EDF4FF", "#C7DDFB", "网易云音乐客户端", "Windows 桌面版 · 调试端口 9222"),
        node(xs[1], y, w, h, "#EFF8F3", "#C6E6D5", "CDP 桥", "ncm.js · 每 100ms 读一次播放状态"),
        node(xs[2], y, w, h, "#F5F1FC", "#DCD0F2", "Electron 主进程", "main.js / lyrics.js / settings.js"),
        node(xs[3], y, w, h, "#FFF4EA", "#F3D9BE", "悬浮歌词条", "overlay · 置顶无边框窗口"),
    ]
    for a, b in zip(xs, xs[1:]):
        parts.append(arrow(a + w + 8, b - 8, y + h / 2))
    parts.append(group(
        28, 226, 560, "歌词来源",
        ["music.163.com", "lrclib.net 回退", "本地 .lrc 导入"],
        "按歌曲缓存于 settings.json，切歌不重复请求", 741))
    parts.append(group(
        612, 226, 560, "颜色与外观",
        ["冻结桌面帧", "取像素", "OKLCH 明暗"],
        "取色期间歌词条实时预览，松手才写入设置", 1035))
    parts.append(f'<text x="600" y="440" text-anchor="middle" font-family="{FONT}" '
                 f'font-size="14" fill="{MUTED}">全部在本机完成 · 不上传播放记录 · 不修改网易云客户端文件</text>')
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 460" width="1200" height="460" role="img" aria-label="浮词的数据链路">\n    ' + "\n    ".join(parts) + "\n</svg>\n"


def main():
    ASSETS.mkdir(exist_ok=True)
    for name, content in (("hero.svg", hero()), ("architecture.svg", architecture())):
        path = ASSETS / name
        path.write_text(content, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({len(content.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
