from __future__ import annotations

import json
import math
import re
import shutil
from pathlib import Path
from typing import Iterable

import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "manual"
PAGES = OUT / "pages"
PDF_OUT = ROOT / "output" / "pdf"

W, H = 1240, 1754
M = 72

COLORS = {
    "bg": "#F6F7FF",
    "paper": "#FFFFFF",
    "ink": "#14213D",
    "muted": "#61708F",
    "line": "#DDE3F1",
    "violet": "#7C3AED",
    "violet_dark": "#5B21B6",
    "violet_soft": "#F0E9FF",
    "blue": "#2563EB",
    "blue_soft": "#EAF2FF",
    "cyan": "#0891B2",
    "cyan_soft": "#E6F9FC",
    "green": "#059669",
    "green_soft": "#E8FAF3",
    "amber": "#D97706",
    "amber_soft": "#FFF5D9",
    "dark": "#111827",
}

FONT_REGULAR = "C:/Windows/Fonts/msyh.ttc"
FONT_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_MONO = "C:/Windows/Fonts/consola.ttf"

ASSETS = {
    "logo": ROOT / "public" / "brand" / "vaultide-logo-horizontal.png",
    "home": ROOT / "output" / "playwright" / "vaultide-brand" / "01-home-vaultide.png",
    "guide": ROOT
    / "output"
    / "playwright"
    / "ux-optimized"
    / "02-obsidian-guide-optimized.png",
    "classroom": ROOT
    / "output"
    / "playwright"
    / "ux-optimized"
    / "03-classroom-optimized.png",
    "writeback": ROOT
    / "output"
    / "playwright"
    / "ux-optimized"
    / "04-writeback-optimized.png",
    "knowledge": ROOT
    / "output"
    / "playwright"
    / "ux-optimized"
    / "04-knowledge-optimized.png",
    "pairing": ROOT
    / "output"
    / "playwright"
    / "ux-optimized"
    / "05-pairing-optimized.png",
}

URL = "https://openmaic-eight-eosin.vercel.app"
CMD_PREVIEW = "Preview active note as a SourceBundle"
CMD_WRITEBACK = "Check and apply Vaultide writebacks"


def font(size: int, bold: bool = False, mono: bool = False) -> ImageFont.FreeTypeFont:
    path = FONT_MONO if mono else FONT_BOLD if bold else FONT_REGULAR
    return ImageFont.truetype(path, size=size)


def rounded(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill: str, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def shadow_card(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    radius: int = 28,
    fill: str = COLORS["paper"],
    outline: str = COLORS["line"],
    shadow_alpha: int = 28,
):
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle((x1, y1 + 10, x2, y2 + 10), radius=radius, fill=(31, 41, 80, shadow_alpha))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas.alpha_composite(shadow)
    draw = ImageDraw.Draw(canvas)
    rounded(draw, box, radius, fill, outline, 2)


def gradient_background(top="#F8FAFF", bottom="#F0ECFF") -> Image.Image:
    im = Image.new("RGBA", (W, H))
    top_rgb = tuple(int(top[i : i + 2], 16) for i in (1, 3, 5))
    bottom_rgb = tuple(int(bottom[i : i + 2], 16) for i in (1, 3, 5))
    px = im.load()
    for y in range(H):
        t = y / max(1, H - 1)
        c = tuple(round(top_rgb[i] * (1 - t) + bottom_rgb[i] * t) for i in range(3))
        for x in range(W):
            px[x, y] = (*c, 255)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((620, 30, 1320, 730), fill=(124, 58, 237, 38))
    gd.ellipse((-240, 930, 520, 1690), fill=(37, 99, 235, 25))
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    im.alpha_composite(glow)
    return im


def text_width(draw: ImageDraw.ImageDraw, text: str, fnt) -> int:
    return int(draw.textbbox((0, 0), text, font=fnt)[2])


def wrap_text(draw: ImageDraw.ImageDraw, text: str, fnt, max_width: int) -> list[str]:
    closing_punctuation = set("，。；：！？、）》】”’…")
    lines: list[str] = []
    for paragraph in text.split("\n"):
        if not paragraph:
            lines.append("")
            continue
        tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9._:/+\-]*|[\u4e00-\u9fff]|[^\u4e00-\u9fffA-Za-z0-9\s]|\s+", paragraph)
        line = ""
        for token in tokens:
            if token.isspace():
                token = " "
            candidate = line + token
            if line and text_width(draw, candidate, fnt) > max_width:
                if token in closing_punctuation:
                    line += token
                    continue
                lines.append(line)
                line = token.lstrip()
            else:
                line = candidate
        if line:
            lines.append(line)
    return lines


def draw_paragraph(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    fnt,
    fill: str,
    max_width: int,
    line_gap: int = 10,
    max_lines: int | None = None,
) -> int:
    lines = wrap_text(draw, text, fnt, max_width)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines:
            lines[-1] = lines[-1][:-1] + "…"
    x, y = xy
    bbox = draw.textbbox((0, 0), "国Ag", font=fnt)
    line_h = bbox[3] - bbox[1]
    for idx, line in enumerate(lines):
        draw.text((x, y + idx * (line_h + line_gap)), line, font=fnt, fill=fill)
    return y + len(lines) * (line_h + line_gap)


def add_logo(canvas: Image.Image, x: int, y: int, width: int):
    logo = Image.open(ASSETS["logo"]).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (x, y))


def rounded_image(canvas: Image.Image, path: Path, box: tuple[int, int, int, int], radius=24, contain=True):
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    src = Image.open(path).convert("RGB")
    if contain:
        src.thumbnail((bw, bh), Image.Resampling.LANCZOS)
        frame = Image.new("RGB", (bw, bh), "#F8FAFC")
        frame.paste(src, ((bw - src.width) // 2, (bh - src.height) // 2))
    else:
        scale = max(bw / src.width, bh / src.height)
        src = src.resize((round(src.width * scale), round(src.height * scale)), Image.Resampling.LANCZOS)
        left = (src.width - bw) // 2
        top = (src.height - bh) // 2
        frame = src.crop((left, top, left + bw, top + bh))
    frame = frame.convert("RGBA")
    mask = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, bw, bh), radius=radius, fill=255)
    frame.putalpha(mask)
    canvas.alpha_composite(frame, (x1, y1))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, radius=radius, outline=COLORS["line"], width=2)


def rounded_image_crop(
    canvas: Image.Image,
    path: Path,
    source_box: tuple[int, int, int, int],
    box: tuple[int, int, int, int],
    radius=24,
):
    x1, y1, x2, y2 = box
    bw, bh = x2 - x1, y2 - y1
    src = Image.open(path).convert("RGB").crop(source_box)
    scale = max(bw / src.width, bh / src.height)
    src = src.resize((round(src.width * scale), round(src.height * scale)), Image.Resampling.LANCZOS)
    left = max(0, (src.width - bw) // 2)
    top = max(0, (src.height - bh) // 2)
    frame = src.crop((left, top, left + bw, top + bh)).convert("RGBA")
    mask = Image.new("L", (bw, bh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, bw, bh), radius=radius, fill=255)
    frame.putalpha(mask)
    canvas.alpha_composite(frame, (x1, y1))
    ImageDraw.Draw(canvas).rounded_rectangle(box, radius=radius, outline=COLORS["line"], width=2)


def header(canvas: Image.Image, page_no: int, section: str):
    d = ImageDraw.Draw(canvas)
    add_logo(canvas, M, 42, 300)
    d.text((W - M, 58), f"{page_no:02d}  /  08", font=font(23, bold=True), fill=COLORS["muted"], anchor="ra")
    d.text((W - M, 96), section, font=font(20), fill=COLORS["violet"], anchor="ra")


def footer(canvas: Image.Image):
    d = ImageDraw.Draw(canvas)
    d.line((M, H - 92, W - M, H - 92), fill=COLORS["line"], width=2)
    d.text((M, H - 70), "知洄 Vaultide 个人智能学习系统", font=font(18), fill=COLORS["muted"])
    d.text((W - M, H - 70), URL, font=font(17), fill=COLORS["violet_dark"], anchor="ra")


def title_block(canvas: Image.Image, title: str, subtitle: str, y=160) -> int:
    d = ImageDraw.Draw(canvas)
    y2 = draw_paragraph(d, (M, y), title, font(52, bold=True), COLORS["ink"], W - 2 * M, line_gap=9)
    y3 = draw_paragraph(d, (M, y2 + 16), subtitle, font(25), COLORS["muted"], W - 2 * M, line_gap=7)
    return y3


def pill(d: ImageDraw.ImageDraw, x: int, y: int, text: str, fill: str, color: str, fnt=None, pad_x=18, h=46):
    fnt = fnt or font(20, bold=True)
    w = text_width(d, text, fnt) + pad_x * 2
    rounded(d, (x, y, x + w, y + h), h // 2, fill)
    d.text((x + pad_x, y + h // 2), text, font=fnt, fill=color, anchor="lm")
    return w


def number_badge(d: ImageDraw.ImageDraw, x: int, y: int, n: str, color: str):
    d.ellipse((x, y, x + 52, y + 52), fill=color)
    d.text((x + 26, y + 26), n, font=font(20, bold=True), fill="white", anchor="mm")


def step_card(canvas: Image.Image, box, n: str, title: str, body: str, color: str, soft: str):
    shadow_card(canvas, box, radius=22, shadow_alpha=15)
    d = ImageDraw.Draw(canvas)
    x1, y1, x2, y2 = box
    number_badge(d, x1 + 22, y1 + 22, n, color)
    title_size = 27
    title_font = font(title_size, bold=True)
    title_width = x2 - x1 - 112
    while title_size > 20 and text_width(d, title, title_font) > title_width:
        title_size -= 1
        title_font = font(title_size, bold=True)
    d.text((x1 + 90, y1 + 26), title, font=title_font, fill=COLORS["ink"])
    draw_paragraph(d, (x1 + 90, y1 + 72), body, font(20), COLORS["muted"], x2 - x1 - 118, line_gap=7)
    rounded(d, (x1 + 20, y2 - 13, x2 - 20, y2 - 7), 3, soft)


def qr_image(size=210) -> Image.Image:
    qr = qrcode.QRCode(version=None, box_size=8, border=2)
    qr.add_data(URL)
    qr.make(fit=True)
    image = qr.make_image(fill_color=COLORS["dark"], back_color="white").convert("RGBA")
    return image.resize((size, size), Image.Resampling.NEAREST)


def save_page(canvas: Image.Image, number: int) -> Path:
    path = PAGES / f"page-{number:02d}.png"
    canvas.convert("RGB").save(path, quality=95)
    return path


def page_1() -> Path:
    im = gradient_background()
    d = ImageDraw.Draw(im)
    add_logo(im, M, 70, 380)
    pill(d, M, 205, "为个人深度学习打造", COLORS["violet_soft"], COLORS["violet_dark"])
    draw_paragraph(d, (M, 286), "把搜索、课堂、笔记\n连成一个学习闭环", font(66, bold=True), COLORS["ink"], 910, line_gap=16)
    draw_paragraph(
        d,
        (M, 492),
        "从外部权威资料到互动课堂，再到 Obsidian 沉淀与三维知识归纳。",
        font(29),
        COLORS["muted"],
        1030,
        line_gap=8,
    )
    shadow_card(im, (M, 610, W - M, 1288), radius=34, shadow_alpha=35)
    rounded_image(im, ASSETS["home"], (M + 28, 638, W - M - 28, 1260), radius=24, contain=True)
    tags = [("外部知识学习", COLORS["blue_soft"], COLORS["blue"]), ("Obsidian 回写", COLORS["violet_soft"], COLORS["violet_dark"]), ("三维知识归纳", COLORS["cyan_soft"], COLORS["cyan"])]
    x = M
    for txt, fill, color in tags:
        x += pill(d, x, 1330, txt, fill, color, font(21, bold=True), pad_x=20, h=52) + 16
    d.text((M, 1445), "知洄 Vaultide", font=font(30, bold=True), fill=COLORS["ink"])
    d.text((M, 1493), "宣传与使用手册", font=font(25), fill=COLORS["muted"])
    qr = qr_image(180)
    im.alpha_composite(qr, (W - M - 180, 1420))
    d.text((W - M - 90, 1610), "扫码开始学习", font=font(18, bold=True), fill=COLORS["violet_dark"], anchor="ma")
    d.text((M, H - 55), URL, font=font(20), fill=COLORS["violet_dark"])
    return save_page(im, 1)


def page_2() -> Path:
    im = gradient_background("#FBFCFF", "#F4F0FF")
    header(im, 2, "核心能力")
    y = title_block(im, "三种学习方式，一套闭环", "先选择学习入口，再让结果自动进入长期知识系统。")
    d = ImageDraw.Draw(im)
    cards = [
        ("01", "外部新知识", "联网检索权威资料，生成可互动课堂。", COLORS["blue"], COLORS["blue_soft"]),
        ("02", "Obsidian 已有内容", "把当前笔记送入课堂，进度安全回写。", COLORS["violet"], COLORS["violet_soft"]),
        ("03", "跨时间 / 跨板块归纳", "汇总多个课堂，查看三维知识关系。", COLORS["cyan"], COLORS["cyan_soft"]),
    ]
    cy = y + 42
    for n, title, body, color, soft in cards:
        step_card(im, (M, cy, W - M, cy + 150), n, title, body, color, soft)
        cy += 170
    shadow_card(im, (M, cy + 10, W - M, 1560), radius=26, shadow_alpha=22)
    rounded_image(im, ASSETS["home"], (M + 24, cy + 34, W - M - 24, 1536), radius=20, contain=True)
    footer(im)
    return save_page(im, 2)


def page_3() -> Path:
    im = gradient_background("#F8FBFF", "#EDF5FF")
    header(im, 3, "外部知识学习")
    y = title_block(im, "从“完全陌生”到“能讲出来”", "搜索不是终点：资料必须进入互动课堂，并产生可回顾的学习记录。")
    d = ImageDraw.Draw(im)
    steps = [
        ("1", "提出学习目标", "在首页描述想学什么、已有基础和希望达成的结果。"),
        ("2", "开启联网检索", "优先使用官方、学术或高权威来源，保留引用。"),
        ("3", "进入互动课堂", "播放讲解、切换场景、回答问题、使用白板。"),
        ("4", "沉淀学习记录", "网页批准后，在 Obsidian 中进行最终确认。"),
    ]
    sy = y + 38
    for i, (n, t, b) in enumerate(steps):
        bx = M if i % 2 == 0 else 632
        by = sy + (i // 2) * 172
        step_card(im, (bx, by, bx + 536, by + 150), n, t, b, COLORS["blue"], COLORS["blue_soft"])
    card_y = sy + 370
    shadow_card(im, (M, card_y, W - M, 1554), radius=26, shadow_alpha=22)
    d.text((M + 28, card_y + 24), "网页课堂是主要学习场景", font=font(28, bold=True), fill=COLORS["ink"])
    d.text((W - M - 28, card_y + 32), "场景进度 · 语音 · 白板 · 对话", font=font(19), fill=COLORS["blue"], anchor="ra")
    rounded_image(im, ASSETS["classroom"], (M + 28, card_y + 76, W - M - 28, 1528), radius=18, contain=True)
    footer(im)
    return save_page(im, 3)


def command_box(im: Image.Image, y: int, label: str, command: str, color: str):
    d = ImageDraw.Draw(im)
    rounded(d, (M, y, W - M, y + 118), 18, "#111827")
    d.text((M + 24, y + 20), label, font=font(18, bold=True), fill="#A5B4FC")
    d.text((M + 24, y + 63), command, font=font(21, mono=True), fill="#F8FAFC")
    rounded(d, (W - M - 146, y + 28, W - M - 24, y + 90), 14, color)
    d.text((W - M - 85, y + 59), "复制", font=font(18, bold=True), fill="white", anchor="mm")


def page_4() -> Path:
    im = gradient_background("#FCFAFF", "#F4EEFF")
    header(im, 4, "Obsidian 学习")
    y = title_block(im, "让已有笔记重新进入课堂", "Obsidian 负责选择与沉淀；网页负责讲解、互动和学习进度。")
    d = ImageDraw.Draw(im)
    command_box(im, y + 40, "第一步 · Obsidian 命令面板", CMD_PREVIEW, COLORS["violet"])
    sy = y + 190
    steps = [
        ("1", "打开一份不敏感笔记", "确认它正是本次学习材料。"),
        ("2", "预览为 SourceBundle", "插件展示即将上传的标题、标签和正文。"),
        ("3", "回到网页生成课堂", "课堂会读取最新上传的 SourceBundle。"),
    ]
    for i, (n, t, b) in enumerate(steps):
        bx = M + i * 372
        step_card(im, (bx, sy, bx + 350, sy + 196), n, t, b, COLORS["violet"], COLORS["violet_soft"])
    shadow_card(im, (M, sy + 232, W - M, 1560), radius=26, shadow_alpha=22)
    rounded_image_crop(
        im,
        ASSETS["guide"],
        (220, 45, 1020, 650),
        (M + 28, sy + 260, W - M - 28, 1532),
        radius=18,
    )
    footer(im)
    return save_page(im, 4)


def page_5() -> Path:
    im = gradient_background("#FBFAFF", "#F0EDFF")
    header(im, 5, "受控回写")
    y = title_block(im, "回写不是自动覆盖，而是双重确认", "知洄只在专用目录创建新笔记；不会删除或静默修改原笔记。")
    d = ImageDraw.Draw(im)
    flags = [
        ("只创建新笔记", COLORS["green_soft"], COLORS["green"]),
        ("网页先预览批准", COLORS["violet_soft"], COLORS["violet"]),
        ("Obsidian 最终确认", COLORS["blue_soft"], COLORS["blue"]),
    ]
    x = M
    for txt, fill, color in flags:
        x += pill(d, x, y + 38, txt, fill, color, font(21, bold=True), pad_x=18, h=52) + 12
    shadow_card(im, (M, y + 120, W - M, 1110), radius=28, shadow_alpha=25)
    rounded_image_crop(
        im,
        ASSETS["writeback"],
        (205, 150, 1055, 565),
        (M + 26, y + 146, W - M - 26, 1084),
        radius=20,
    )
    command_box(im, 1150, "网页批准后 · Obsidian 命令面板", CMD_WRITEBACK, COLORS["violet"])
    rounded(d, (M, 1300, W - M, 1560), 24, COLORS["amber_soft"])
    d.text((M + 28, 1328), "写入前最后检查", font=font(28, bold=True), fill=COLORS["amber"])
    checklist = [
        "目标 Vault 是否正确",
        "相对路径是否在 Vaultide 专用目录",
        "内容是否只包含学习记录与引用",
        "确认后再应用回写",
    ]
    for i, line in enumerate(checklist):
        yy = 1385 + i * 42
        d.ellipse((M + 30, yy + 7, M + 46, yy + 23), fill=COLORS["amber"])
        d.text((M + 64, yy), line, font=font(21), fill=COLORS["ink"])
    footer(im)
    return save_page(im, 5)


def page_6() -> Path:
    im = gradient_background("#F7FBFF", "#ECF9FB")
    header(im, 6, "知识归纳")
    y = title_block(im, "把多个课堂放进同一张知识地图", "按时间、知识板块和掌握度归纳，发现跨课堂连接与待强化区域。")
    d = ImageDraw.Draw(im)
    dims = [
        ("X", "时间", "学习轨迹如何推进", COLORS["blue"], COLORS["blue_soft"]),
        ("Y", "知识板块", "内容属于哪个领域", COLORS["cyan"], COLORS["cyan_soft"]),
        ("Z", "掌握度", "哪些课堂需要强化", COLORS["violet"], COLORS["violet_soft"]),
    ]
    for i, (axis, title, body, color, soft) in enumerate(dims):
        x1 = M + i * 372
        rounded(d, (x1, y + 38, x1 + 350, y + 200), 22, soft)
        d.text((x1 + 24, y + 62), axis, font=font(44, bold=True), fill=color)
        d.text((x1 + 96, y + 66), title, font=font(26, bold=True), fill=COLORS["ink"])
        draw_paragraph(d, (x1 + 24, y + 126), body, font(19), COLORS["muted"], 300, line_gap=5)
    shot_top = y + 238
    shot_bottom = shot_top + 420
    shadow_card(im, (M, shot_top, W - M, shot_bottom), radius=28, shadow_alpha=25)
    rounded_image_crop(
        im,
        ASSETS["knowledge"],
        (0, 0, 1280, 430),
        (M + 26, shot_top + 26, W - M - 26, shot_bottom - 26),
        radius=20,
    )
    graph_top = shot_bottom + 24
    graph_bottom = graph_top + 270
    rounded(d, (M, graph_top, W - M, graph_bottom), 24, COLORS["paper"], COLORS["line"], 2)
    d.text((M + 24, graph_top + 20), "三维关系示意", font=font(24, bold=True), fill=COLORS["ink"])
    d.text((M + 238, graph_top + 26), "X = 时间  ·  Y = 板块  ·  Z = 掌握度", font=font(18), fill=COLORS["muted"])
    graph_nodes = [
        (M + 170, graph_top + 170, 24, COLORS["blue"]),
        (M + 350, graph_top + 112, 18, COLORS["cyan"]),
        (M + 520, graph_top + 190, 27, COLORS["violet"]),
        (M + 690, graph_top + 126, 20, COLORS["blue"]),
        (M + 870, graph_top + 186, 25, COLORS["cyan"]),
        (M + 1010, graph_top + 106, 17, COLORS["violet"]),
    ]
    graph_edges = [(0, 1), (0, 2), (1, 2), (1, 3), (2, 3), (2, 4), (3, 4), (3, 5), (4, 5)]
    for a, b in graph_edges:
        d.line((graph_nodes[a][0], graph_nodes[a][1], graph_nodes[b][0], graph_nodes[b][1]), fill="#B8C4E3", width=4)
    for idx, (cx, cy, radius, color) in enumerate(graph_nodes):
        d.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=color)
        d.text((cx, cy), str(idx + 1), font=font(14, bold=True), fill="white", anchor="mm")
    outcomes_y = graph_bottom + 24
    outcomes = [
        ("先筛选", "限定时间、来源或板块"),
        ("再观察", "找到密集连接与薄弱区域"),
        ("后沉淀", "生成专门的归纳笔记"),
    ]
    for i, (heading, body) in enumerate(outcomes):
        x1 = M + i * 372
        rounded(d, (x1, outcomes_y, x1 + 350, outcomes_y + 154), 22, COLORS["paper"], COLORS["line"], 2)
        number_badge(d, x1 + 20, outcomes_y + 22, str(i + 1), COLORS["cyan"])
        d.text((x1 + 88, outcomes_y + 24), heading, font=font(24, bold=True), fill=COLORS["ink"])
        draw_paragraph(d, (x1 + 24, outcomes_y + 84), body, font(19), COLORS["muted"], 300, line_gap=5)
    footer(im)
    return save_page(im, 6)


def page_7() -> Path:
    im = gradient_background("#FAFCFF", "#F3F6FF")
    header(im, 7, "快速开始")
    y = title_block(im, "第一次使用：5 分钟完成", "先完成设备配对，再决定从外部知识还是 Obsidian 笔记开始。")
    d = ImageDraw.Draw(im)
    steps = [
        ("1", "打开配对页", "在网页生成 10 分钟一次性六位码。"),
        ("2", "填写插件设置", "知洄服务地址使用正式部署地址。"),
        ("3", "输入六位码并 Pair", "设备令牌仅保存在 Obsidian SecretStorage。"),
        ("4", "上传一份测试笔记", f"执行：{CMD_PREVIEW}"),
        ("5", "回到网页开始课堂", "学习完成后再决定是否回写。"),
    ]
    sy = y + 34
    for i, (n, t, b) in enumerate(steps):
        step_card(im, (M, sy + i * 146, W - M, sy + i * 146 + 126), n, t, b, COLORS["violet"], COLORS["violet_soft"])
    qr = qr_image(220)
    rounded(d, (M, sy + 5 * 146 + 12, W - M, 1570), 26, COLORS["paper"], COLORS["line"], 2)
    im.alpha_composite(qr, (M + 28, sy + 5 * 146 + 34))
    d.text((M + 290, sy + 5 * 146 + 46), "正式访问地址", font=font(22, bold=True), fill=COLORS["muted"])
    d.text((M + 290, sy + 5 * 146 + 98), URL, font=font(24, bold=True), fill=COLORS["violet_dark"])
    d.text((M + 290, sy + 5 * 146 + 153), "建议收藏网页；课堂学习以网页为主。", font=font(20), fill=COLORS["ink"])
    footer(im)
    return save_page(im, 7)


def page_8() -> Path:
    im = gradient_background("#FBFCFF", "#F2EEFF")
    header(im, 8, "最佳实践")
    y = title_block(im, "把知洄变成长期学习系统", "关键不在“生成更多课堂”，而在持续检索、练习、回写与归纳。")
    d = ImageDraw.Draw(im)
    loop = [
        ("01", "学习", "一次只解决一个明确问题"),
        ("02", "练习", "主动回忆，不只被动播放"),
        ("03", "沉淀", "把来源、结论、进度写回"),
        ("04", "归纳", "每周按时间 / 板块复盘"),
    ]
    center = (W // 2, 720)
    radius_x = 330
    radius_y = 210
    for i, (n, title, body) in enumerate(loop):
        angle = math.radians(-90 + i * 90)
        cx = round(center[0] + math.cos(angle) * radius_x)
        cy = round(center[1] + math.sin(angle) * radius_y)
        box = (cx - 170, cy - 86, cx + 170, cy + 86)
        shadow_card(im, box, radius=24, shadow_alpha=18)
        number_badge(d, box[0] + 18, box[1] + 18, n, COLORS["violet"])
        d.text((box[0] + 84, box[1] + 20), title, font=font(27, bold=True), fill=COLORS["ink"])
        draw_paragraph(d, (box[0] + 84, box[1] + 66), body, font(18), COLORS["muted"], 235, line_gap=4)
    d.ellipse((center[0] - 118, center[1] - 118, center[0] + 118, center[1] + 118), fill=COLORS["violet"])
    d.text(center, "学习\n闭环", font=font(40, bold=True), fill="white", anchor="mm", align="center")
    rounded(d, (M, 1050, W - M, 1515), 28, COLORS["paper"], COLORS["line"], 2)
    d.text((M + 28, 1080), "常见问题速查", font=font(30, bold=True), fill=COLORS["ink"])
    rows = [
        ("课堂一直加载", "确认课堂链接有效；旧临时课堂可能已失效。"),
        ("搜索 429", "配置 Tavily / Brave API Key，或稍后重试。"),
        ("听不到声音", "检查 TTS 是否启用、音量和静音状态。"),
        ("回写未出现", f"网页批准后执行：{CMD_WRITEBACK}"),
    ]
    ry = 1140
    for q, a in rows:
        d.text((M + 30, ry), q, font=font(21, bold=True), fill=COLORS["violet_dark"])
        draw_paragraph(d, (M + 300, ry), a, font(20), COLORS["muted"], 760, line_gap=5, max_lines=2)
        d.line((M + 28, ry + 72, W - M - 28, ry + 72), fill=COLORS["line"], width=2)
        ry += 92
    d.text((M, 1575), "现在开始：选择一个真实问题，完成第一轮学习闭环。", font=font(27, bold=True), fill=COLORS["violet_dark"])
    footer(im)
    return save_page(im, 8)


def create_poster(page_1_path: Path) -> Path:
    page = Image.open(page_1_path).convert("RGB")
    poster_path = OUT / "Vaultide-宣传海报.png"
    page.save(poster_path, quality=95)
    return poster_path


def create_pdf(page_paths: Iterable[Path]) -> Path:
    images = [Image.open(path).convert("RGB") for path in page_paths]
    pdf_path = OUT / "Vaultide-宣传使用手册.pdf"
    images[0].save(pdf_path, save_all=True, append_images=images[1:], resolution=150.0)
    return pdf_path


def create_presentation_assets():
    crops = {
        "guide-dialog.png": ("guide", (220, 45, 1020, 650)),
        "writeback-dialog.png": ("writeback", (205, 150, 1055, 565)),
        "knowledge-controls.png": ("knowledge", (0, 0, 1280, 430)),
    }
    for filename, (asset_key, source_box) in crops.items():
        Image.open(ASSETS[asset_key]).convert("RGB").crop(source_box).save(OUT / filename, quality=95)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PAGES.mkdir(parents=True, exist_ok=True)
    PDF_OUT.mkdir(parents=True, exist_ok=True)
    missing = [str(path) for path in ASSETS.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing assets:\n" + "\n".join(missing))

    builders = [page_1, page_2, page_3, page_4, page_5, page_6, page_7, page_8]
    page_paths = [builder() for builder in builders]
    poster = create_poster(page_paths[0])
    pdf = create_pdf(page_paths)
    create_presentation_assets()
    qr_image(600).convert("RGB").save(OUT / "qr-vaultide.png", quality=100)
    shutil.copy2(pdf, PDF_OUT / pdf.name)

    manifest = {
        "title": "知洄 Vaultide 宣传与使用手册",
        "version": "2026-07-23",
        "url": URL,
        "outputs": {
            "poster": poster.name,
            "manualPdf": pdf.name,
            "editablePresentation": "Vaultide-宣传使用手册.pptx",
            "pagePreviews": [path.relative_to(OUT).as_posix() for path in page_paths],
        },
        "sourceAssets": {key: str(path.relative_to(ROOT)) for key, path in ASSETS.items()},
        "exactCommands": [CMD_PREVIEW, CMD_WRITEBACK],
        "notes": [
            "所有产品界面均来自 2026-07-23 后台验证截图。",
            "功能名称、命令与正式访问地址采用确定性排版。",
            "未使用生成式图像改写产品截图或品牌标识。",
        ],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "provenance.md").write_text(
        "\n".join(
            [
                "# 设计与来源说明",
                "",
                "- 品牌：知洄 Vaultide 独立品牌标记。",
                "- 技术来源：基于 OpenMAIC 构建，并通过本地连接器与 Obsidian 协同。",
                "- 界面：本地同版本后台浏览器验证截图。",
                "- 排版：Pillow 确定性生成，A4 竖版 1240 × 1754。",
                "- 演示版：PptxGenJS 生成 16:9 可编辑 PPTX，使用同一套文案与真实界面截图。",
                "- 文案：仅描述已验证功能，不包含价格、认证或未实现能力。",
                f"- 正式地址：{URL}",
                f"- Obsidian 导入命令：`{CMD_PREVIEW}`",
                f"- Obsidian 回写命令：`{CMD_WRITEBACK}`",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(json.dumps(manifest["outputs"], ensure_ascii=False))


if __name__ == "__main__":
    main()
