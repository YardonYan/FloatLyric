# -*- coding: utf-8 -*-
"""Build README media from live captures:
- assets/demo-strip.gif : the real lyric strip captured frame by frame (2x)
- assets/panel-guide.png : panel screenshot with numbered callouts explaining
  where to press what. Run after tools/cap_frames.ps1.
"""
import glob
import os
from PIL import Image, ImageDraw, ImageFont

TEMP = r"C:\Users\admin\AppData\Local\Temp"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")

# ---------------------------------------------------------------- GIF
frames = sorted(glob.glob(os.path.join(TEMP, "flgif", "f*.png")))
assert frames, "no captured frames"

prev = None
seq = []
for f in frames:
    im = Image.open(f).convert("RGB")
    if prev is not None and list(im.getdata()) == list(prev.getdata()):
        continue
    seq.append(im)
    prev = im

big = [im.resize((im.width * 2, im.height * 2), Image.NEAREST) for im in seq]
out_gif = os.path.join(ASSETS, "demo-strip.gif")
big[0].save(
    out_gif, save_all=True, append_images=big[1:], duration=280, loop=0,
    optimize=True,
)
print("gif:", out_gif, big[0].size, len(big), "frames",
      os.path.getsize(out_gif) // 1024, "KB")

# ---------------------------------------------------------------- guide
panel = Image.open(os.path.join(TEMP, "fl_panel_v2.png")).convert("RGB")
pad = 16
text_x = panel.width + 90
canvas_w = text_x + 400
canvas_h = panel.height + pad * 2
canvas = Image.new("RGB", (canvas_w, canvas_h), (246, 248, 251))
canvas.paste(panel, (pad, pad))
d = ImageDraw.Draw(canvas)

def font(sz, bold=False):
    p = r"C:\Windows\Fonts\msyhbd.ttc" if bold else r"C:\Windows\Fonts\msyh.ttc"
    return ImageFont.truetype(p, sz)

notes = [
    ((130, 115), "播放控制", "上一首 / 暂停 / 下一首，直接遥控网易云"),
    ((206, 158), "今日听歌", "点一下打开听歌统计窗口"),
    ((160, 315), "连接向导", "一键启动或重启网易云，只需配置这一次"),
    ((206, 478), "风格预设", "点一下换一套外观，蓝色边框是当前生效的"),
    ((110, 535), "屏幕取色针", "吸一下界面文字的颜色，歌词就融进去了"),
]

line_col = (61, 90, 168)
dot_col = (61, 90, 168)
ink = (36, 48, 68)
sub = (90, 102, 120)

for (ax, ay), title, desc in notes:
    py = ay + pad
    d.line([(ax + 14, py), (text_x - 16, py)], fill=line_col, width=1)
    d.ellipse([ax - 13, py - 13, ax + 13, py + 13], fill=dot_col)
    n = str(notes.index(((ax, ay), title, desc)) + 1)
    bb = d.textbbox((0, 0), n, font=font(13, True))
    d.text((ax - (bb[2] - bb[0]) / 2, py - (bb[3] - bb[1]) / 2 - 1), n,
           font=font(13, True), fill=(255, 255, 255))
    d.text((text_x, py - 15), title, font=font(15, True), fill=ink)
    d.text((text_x, py + 3), desc, font=font(12), fill=sub)

out_png = os.path.join(ASSETS, "panel-guide.png")
canvas.save(out_png)
print("guide:", out_png, canvas.size, os.path.getsize(out_png) // 1024, "KB")
