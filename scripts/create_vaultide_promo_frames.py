from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "vaultide-2026"
FRAMES = OUT / "video-frames"
W, H = 1920, 1080
M = 110

FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"

COLORS = {
    "navy": "#071029",
    "ink": "#0F1B3D",
    "muted": "#607096",
    "violet": "#7C3AED",
    "cyan": "#22D3EE",
    "blue": "#2563EB",
    "pale": "#F4F6FF",
    "white": "#FFFFFF",
}

ASSETS = {
    "hero": ROOT / "public" / "brand" / "vaultide-knowledge-loop-hero-v2.png",
    "logo_light": ROOT / "public" / "brand" / "vaultide-logo-horizontal-light.png",
    "logo": ROOT / "public" / "brand" / "vaultide-logo-horizontal.png",
    "home": ROOT / "output" / "playwright" / "vaultide-brand" / "01-home-vaultide.png",
    "classroom": ROOT / "output" / "playwright" / "ux-optimized" / "03-classroom-optimized.png",
    "knowledge": ROOT
    / "output"
    / "playwright"
    / "audit-large-project"
    / "02-knowledge-synthesis-3d.png",
}


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_BOLD if bold else FONT_REGULAR, size=size)


def cover(path: Path, size: tuple[int, int]) -> Image.Image:
    width, height = size
    image = Image.open(path).convert("RGB")
    scale = max(width / image.width, height / image.height)
    image = image.resize(
        (round(image.width * scale), round(image.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (image.width - width) // 2)
    top = max(0, (image.height - height) // 2)
    return image.crop((left, top, left + width, top + height)).convert("RGBA")


def gradient(top: str, bottom: str) -> Image.Image:
    top_rgb = tuple(int(top[index : index + 2], 16) for index in (1, 3, 5))
    bottom_rgb = tuple(int(bottom[index : index + 2], 16) for index in (1, 3, 5))
    image = Image.new("RGBA", (W, H))
    pixels = image.load()
    for y in range(H):
        ratio = y / (H - 1)
        color = tuple(
            round(top_rgb[index] * (1 - ratio) + bottom_rgb[index] * ratio)
            for index in range(3)
        )
        for x in range(W):
            pixels[x, y] = (*color, 255)
    return image


def add_glows(image: Image.Image):
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse((1300, -240, 2180, 640), fill=(124, 58, 237, 55))
    draw.ellipse((-320, 560, 620, 1500), fill=(34, 211, 238, 32))
    layer = layer.filter(ImageFilter.GaussianBlur(110))
    image.alpha_composite(layer)


def add_logo(image: Image.Image, light: bool, width: int = 440):
    logo = Image.open(ASSETS["logo_light" if light else "logo"]).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    image.alpha_composite(logo, (M, 68))


def text_width(draw: ImageDraw.ImageDraw, text: str, selected_font) -> int:
    return round(draw.textbbox((0, 0), text, font=selected_font)[2])


def wrap(draw: ImageDraw.ImageDraw, text: str, selected_font, width: int) -> list[str]:
    tokens = re.findall(
        r"[A-Za-z0-9][A-Za-z0-9._:/+\-]*|[\u4e00-\u9fff]|[^\u4e00-\u9fffA-Za-z0-9\s]|\s+",
        text,
    )
    lines: list[str] = []
    line = ""
    for token in tokens:
        candidate = line + (" " if token.isspace() else token)
        if line and text_width(draw, candidate, selected_font) > width:
            lines.append(line)
            line = token.strip()
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines


def paragraph(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    selected_font,
    color: str,
    width: int,
    gap: int = 10,
) -> int:
    x, y = position
    lines: list[str] = []
    for part in text.split("\n"):
        lines.extend(wrap(draw, part, selected_font, width))
    line_height = draw.textbbox((0, 0), "国Ag", font=selected_font)[3]
    for index, line in enumerate(lines):
        draw.text((x, y + index * (line_height + gap)), line, font=selected_font, fill=color)
    return y + len(lines) * (line_height + gap)


def pill(
    draw: ImageDraw.ImageDraw,
    position: tuple[int, int],
    text: str,
    fill: str,
    color: str,
    size: int = 28,
) -> int:
    selected_font = font(size, bold=True)
    width = text_width(draw, text, selected_font) + 48
    x, y = position
    draw.rounded_rectangle((x, y, x + width, y + 56), radius=28, fill=fill)
    draw.text((x + 24, y + 28), text, font=selected_font, fill=color, anchor="lm")
    return width


def screenshot_card(
    image: Image.Image,
    source: Path,
    box: tuple[int, int, int, int],
):
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    shadow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (x1, y1 + 18, x2, y2 + 18),
        radius=34,
        fill=(20, 31, 74, 48),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    image.alpha_composite(shadow)

    source_image = Image.open(source).convert("RGB")
    source_image.thumbnail((width - 36, height - 36), Image.Resampling.LANCZOS)
    frame = Image.new("RGBA", (width, height), "white")
    frame.alpha_composite(
        source_image.convert("RGBA"),
        ((width - source_image.width) // 2, (height - source_image.height) // 2),
    )
    mask = Image.new("L", (width, height), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, width, height), radius=34, fill=255)
    frame.putalpha(mask)
    image.alpha_composite(frame, (x1, y1))


def footer(draw: ImageDraw.ImageDraw, light: bool = False):
    color = "#B9D2FF" if light else COLORS["muted"]
    draw.text(
        (M, H - 62),
        "知洄 Vaultide · 让每次学习，流回你的知识库",
        font=font(22),
        fill=color,
    )
    draw.text(
        (W - M, H - 62),
        "openmaic-eight-eosin.vercel.app",
        font=font(22),
        fill=color,
        anchor="ra",
    )


def save(image: Image.Image, number: int) -> Path:
    path = FRAMES / f"scene-{number:02d}.png"
    image.convert("RGB").save(path, quality=95)
    return path


def scene_1() -> Path:
    image = ImageEnhance.Brightness(cover(ASSETS["hero"], (W, H))).enhance(0.68)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw_overlay = ImageDraw.Draw(overlay)
    draw_overlay.rectangle((0, 0, W, H), fill=(4, 8, 29, 80))
    draw_overlay.rectangle((0, 0, 1140, H), fill=(4, 8, 29, 100))
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=True)
    pill(draw, (M, 228), "2026.07 学习闭环版", "#2A1F58", "#BDF5FF")
    paragraph(
        draw,
        (M, 340),
        "让知识真正\n成为你的能力",
        font(100, bold=True),
        "white",
        920,
        14,
    )
    draw.text(
        (M, 760),
        "个人智能学习操作系统",
        font=font(42),
        fill="#D9E7FF",
    )
    draw.text(
        (M, 830),
        "连接外部知识、互动课堂与 Obsidian",
        font=font(32),
        fill="#BDF5FF",
    )
    footer(draw, light=True)
    return save(image, 1)


def scene_2() -> Path:
    image = gradient("#FBFCFF", "#EEEAFE")
    add_glows(image)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=False, width=360)
    pill(draw, (M, 230), "学习真正的难点", "#EEE8FF", COLORS["violet"])
    draw.text((W // 2, 410), "资料找到了", font=font(74, bold=True), fill=COLORS["ink"], anchor="ma")
    draw.text((W // 2, 535), "课堂听完了", font=font(74, bold=True), fill=COLORS["ink"], anchor="ma")
    draw.text(
        (W // 2, 690),
        "但知识真的留下了吗？",
        font=font(96, bold=True),
        fill=COLORS["violet"],
        anchor="ma",
    )
    footer(draw)
    return save(image, 2)


def scene_3() -> Path:
    image = gradient("#F8FAFF", "#EAF2FF")
    add_glows(image)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=False, width=350)
    pill(draw, (M, 210), "01 · 学习外部新知识", "#E8F0FF", COLORS["blue"])
    paragraph(
        draw,
        (M, 320),
        "从权威资料\n进入互动课堂",
        font(76, bold=True),
        COLORS["ink"],
        670,
        12,
    )
    paragraph(
        draw,
        (M, 580),
        "检索论文、技术、项目和前沿文章\n保留来源，围绕真实目标开始学习",
        font(31),
        COLORS["muted"],
        690,
        12,
    )
    x = M
    for index, label in enumerate(["检索", "课堂", "练习", "沉淀"]):
        width = pill(
            draw,
            (x, 790),
            label,
            COLORS["violet"] if index == 3 else "#E8F0FF",
            "white" if index == 3 else COLORS["blue"],
            size=26,
        )
        x += width + 12
    screenshot_card(image, ASSETS["home"], (830, 160, 1810, 900))
    footer(draw)
    return save(image, 3)


def scene_4() -> Path:
    image = gradient("#FCFAFF", "#F0EAFF")
    add_glows(image)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=False, width=350)
    pill(draw, (M, 205), "02 · 学习 Obsidian 内容", "#EEE8FF", COLORS["violet"])
    paragraph(
        draw,
        (M, 315),
        "已有笔记\n也能重新学一遍",
        font(72, bold=True),
        COLORS["ink"],
        630,
        12,
    )
    steps = [
        ("1", "上传", "只发送你批准的内容"),
        ("2", "学习", "网页是主要课堂场景"),
        ("3", "回写", "Obsidian 最终确认"),
    ]
    y = 630
    for number, title, body in steps:
        draw.rounded_rectangle((M, y, 720, y + 90), radius=22, fill="white")
        draw.ellipse((M + 18, y + 17, M + 74, y + 73), fill=COLORS["violet"])
        draw.text((M + 46, y + 45), number, font=font(24, bold=True), fill="white", anchor="mm")
        draw.text((M + 95, y + 18), title, font=font(29, bold=True), fill=COLORS["ink"])
        draw.text((M + 205, y + 24), body, font=font(24), fill=COLORS["muted"])
        y += 106
    screenshot_card(image, ASSETS["classroom"], (790, 190, 1810, 890))
    footer(draw)
    return save(image, 4)


def scene_5() -> Path:
    image = gradient("#F7FCFF", "#EAF8FB")
    add_glows(image)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=False, width=350)
    pill(draw, (M, 205), "03 · 归纳与三维关系", "#E4F9FC", "#0891B2")
    paragraph(
        draw,
        (M, 315),
        "把多次学习\n放进同一张知识地图",
        font(70, bold=True),
        COLORS["ink"],
        650,
        12,
    )
    paragraph(
        draw,
        (M, 575),
        "按时间、板块、来源和掌握度归纳\n发现跨课堂连接与待强化区域",
        font(30),
        COLORS["muted"],
        680,
        12,
    )
    x = M
    for axis, label, color in [
        ("X", "时间", COLORS["blue"]),
        ("Y", "板块", "#0891B2"),
        ("Z", "掌握度", COLORS["violet"]),
    ]:
        text = f"{axis}  {label}"
        width = pill(draw, (x, 790), text, "white", color, size=27)
        x += width + 14
    screenshot_card(image, ASSETS["knowledge"], (790, 160, 1810, 910))
    footer(draw)
    return save(image, 5)


def scene_6() -> Path:
    image = gradient("#071029", "#11103C")
    add_glows(image)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=True, width=380)
    pill(draw, (M, 220), "你的知识库，由你掌控", "#15384B", "#BDF5FF")
    draw.text(
        (W // 2, 400),
        "原笔记不被静默覆盖",
        font=font(88, bold=True),
        fill="white",
        anchor="ma",
    )
    cards = [
        ("只读来源", "原有笔记保持原样"),
        ("双重确认", "网页批准 + 本地确认"),
        ("专用目录", "学习结果进入 Vaultide/"),
    ]
    for index, (title, body) in enumerate(cards):
        x1 = 150 + index * 555
        draw.rounded_rectangle(
            (x1, 590, x1 + 510, 790),
            radius=28,
            fill=(255, 255, 255, 18),
            outline=(189, 245, 255, 60),
            width=2,
        )
        draw.text((x1 + 255, 640), title, font=font(38, bold=True), fill="#BDF5FF", anchor="ma")
        draw.text((x1 + 255, 720), body, font=font(27), fill="#D9E7FF", anchor="ma")
    footer(draw, light=True)
    return save(image, 6)


def scene_7() -> Path:
    image = ImageEnhance.Brightness(cover(ASSETS["hero"], (W, H))).enhance(0.38)
    layer = Image.new("RGBA", image.size, (5, 9, 30, 145))
    image.alpha_composite(layer)
    draw = ImageDraw.Draw(image)
    add_logo(image, light=True, width=500)
    draw.text(
        (W // 2, 390),
        "从一个真实问题开始",
        font=font(86, bold=True),
        fill="white",
        anchor="ma",
    )
    draw.text(
        (W // 2, 525),
        "完成你的第一轮学习闭环",
        font=font(86, bold=True),
        fill="white",
        anchor="ma",
    )
    draw.rounded_rectangle((510, 685, 1410, 775), radius=45, fill=(34, 211, 238, 35))
    draw.text(
        (W // 2, 730),
        "openmaic-eight-eosin.vercel.app",
        font=font(38, bold=True),
        fill="#BDF5FF",
        anchor="mm",
    )
    draw.text(
        (W // 2, 890),
        "基于 OpenMAIC 构建 · 与 Obsidian 协同 · 非官方产品",
        font=font(26),
        fill="#A8B7D9",
        anchor="ma",
    )
    return save(image, 7)


def main():
    FRAMES.mkdir(parents=True, exist_ok=True)
    missing = [str(path) for path in ASSETS.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing assets:\n" + "\n".join(missing))
    frames = [
        scene_1(),
        scene_2(),
        scene_3(),
        scene_4(),
        scene_5(),
        scene_6(),
        scene_7(),
    ]
    print("\n".join(str(frame) for frame in frames))


if __name__ == "__main__":
    main()
