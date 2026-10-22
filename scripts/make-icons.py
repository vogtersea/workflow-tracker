# -*- coding: utf-8 -*-
"""
生成手机单机版应用图标与启动图（宫墙红 × 鎏金，楷体「工」字印章风格）

用法：python scripts/make-icons.py
覆盖 android/app/src/main/res 下的 mipmap 与 drawable 启动图。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'android', 'app', 'src', 'main', 'res')

PALACE_RED = (127, 29, 29)      # 宫墙红 #7f1d1d
PALACE_DEEP = (95, 20, 20)      # 更深的红，用于渐层底部
GOLD = (212, 160, 23)           # 鎏金 #d4a017
GOLD_LIGHT = (232, 194, 96)     # 高光金
KAITI = r'C:\Windows\Fonts\simkai.ttf'

GLYPH = '工'
APP_NAME = '工作流程跟踪'


def glyph_layer(size, ratio=0.62):
    """透明底 + 鎏金「工」字（带细描边阴影），ratio 为字高占画布比例"""
    layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    font = ImageFont.truetype(KAITI, int(size * ratio))
    bbox = d.textbbox((0, 0), GLYPH, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = (size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]
    # 阴影层
    d.text((x + size * 0.008, y + size * 0.010), GLYPH, font=font, fill=(0, 0, 0, 110))
    # 金字主体（上亮下暗模拟鎏金）
    d.text((x, y), GLYPH, font=font, fill=GOLD)
    return layer


def make_foreground(size):
    """自适应图标前景：字占画布约 40%（安全区 66%）"""
    return glyph_layer(size, ratio=0.40)


def make_legacy(size):
    """传统图标：圆角宫墙红底 + 金色细边 + 「工」字"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(size * 0.18)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=PALACE_RED + (255,))
    # 内嵌金色细框（印章边）
    m = int(size * 0.055)
    d.rounded_rectangle(
        [m, m, size - 1 - m, size - 1 - m],
        radius=int(radius * 0.7),
        outline=GOLD + (255,),
        width=max(1, int(size * 0.018)),
    )
    fg = glyph_layer(size, ratio=0.46)
    img.alpha_composite(fg)
    return img


def make_round(size):
    """圆形图标"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([0, 0, size - 1, size - 1], fill=PALACE_RED + (255,))
    fg = glyph_layer(size, ratio=0.46)
    img.alpha_composite(fg)
    return img


def make_splash(w, h):
    """启动图：宫墙红底、居中金字应用名与「工」字印记"""
    img = Image.new('RGB', (w, h), PALACE_RED)
    d = ImageDraw.Draw(img)
    # 顶部到下的轻微明暗，避免死板
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(PALACE_RED[0] + (PALACE_DEEP[0] - PALACE_RED[0]) * t)
        g = int(PALACE_RED[1] + (PALACE_DEEP[1] - PALACE_RED[1]) * t)
        b = int(PALACE_RED[2] + (PALACE_DEEP[2] - PALACE_RED[2]) * t)
        d.line([(0, y), (w, y)], fill=(r, g, b))

    short = min(w, h)
    # 中央「工」字印记
    seal = glyph_layer(short, ratio=0.34)
    img.paste(seal, ((w - short) // 2, int(h * 0.30) - short // 2), seal)
    # 应用名
    font = ImageFont.truetype(KAITI, max(18, int(short * 0.085)))
    bbox = d.textbbox((0, 0), APP_NAME, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((w - tw) / 2, h * 0.66), APP_NAME, font=font, fill=GOLD_LIGHT)
    return img


DENSITIES = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

for dens, base in DENSITIES.items():
    folder = os.path.join(ROOT, dens)
    os.makedirs(folder, exist_ok=True)
    make_legacy(base).save(os.path.join(folder, 'ic_launcher.png'))
    make_round(base).save(os.path.join(folder, 'ic_launcher_round.png'))
    make_foreground(base * 2).save(os.path.join(folder, 'ic_launcher_foreground.png'))
    print(f'· {dens}: {base}px 完成')

# 自适应图标背景色改为宫墙红
color_xml = os.path.join(ROOT, 'values', 'ic_launcher_background.xml')
with open(color_xml, 'w', encoding='utf-8') as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#7F1D1D</color>\n</resources>\n')
print('· 自适应背景色 → #7F1D1D')

# 启动图（保持原尺寸重绘）
import glob
for p in glob.glob(os.path.join(ROOT, 'drawable-*', 'splash.png')):
    with Image.open(p) as im:
        w, h = im.size
    make_splash(w, h).save(p)
    print(f'· 启动图 {os.path.basename(os.path.dirname(p))}: {w}x{h} 完成')

print('全部图标生成完毕')
