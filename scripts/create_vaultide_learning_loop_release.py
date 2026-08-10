from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
BASE_SCRIPT = ROOT / "scripts" / "create_openmaic_manual.py"
OUT = ROOT / "output" / "vaultide-learning-loop-2026.07"
PAGES = OUT / "pages"
PDF_OUT = ROOT / "output" / "pdf"
URL = "https://openmaic-eight-eosin.vercel.app"
RELEASE = "2026.07 整体学习闭环版"
TAGLINE = "让每次学习，流回你的知识库"
CMD_NOTE = "Preview active note as a SourceBundle"
CMD_FOLDER = "Preview a project folder as a SourceBundle"
CMD_WRITEBACK = "Check and apply Vaultide writebacks"


def load_base():
    spec = importlib.util.spec_from_file_location("vaultide_manual_base", BASE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {BASE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_base()
base.OUT = OUT
base.PAGES = PAGES
base.PDF_OUT = PDF_OUT
base.URL = URL
base.ASSETS.update(
    {
        "hero": ROOT / "public" / "brand" / "vaultide-knowledge-loop-hero-v2.png",
        "logo_light": ROOT / "public" / "brand" / "vaultide-logo-horizontal-light.png",
        "home_loop": ROOT / "output" / "playwright" / "holistic-learning-project-home.png",
        "external": ROOT
        / "output"
        / "playwright"
        / "holistic-product-audit"
        / "02-external-learning-entry.png",
        "obsidian_guide": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-obsidian-guide.png",
        "active_practice": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-active-practice-final.png",
        "writeback_new": ROOT
        / "output"
        / "playwright"
        / "ux-optimized"
        / "04-writeback-optimized.png",
        "question_synthesis": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-question-synthesis.png",
        "knowledge_space": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-space-final.png",
        "mobile": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-mobile-final.png",
    }
)

W, H, M = base.W, base.H, base.M
C = base.COLORS


def manual_header(canvas: Image.Image, page_no: int, section: str):
    d = ImageDraw.Draw(canvas)
    base.add_logo(canvas, M, 42, 300)
    d.text(
        (W - M, 58),
        f"{page_no:02d}  /  10",
        font=base.font(23, bold=True),
        fill=C["muted"],
        anchor="ra",
    )
    d.text(
        (W - M, 96),
        section,
        font=base.font(20),
        fill=C["violet"],
        anchor="ra",
    )


def cover_crop(path: Path, size: tuple[int, int]) -> Image.Image:
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


def add_logo(canvas: Image.Image, x: int, y: int, width: int, light: bool = False):
    key = "logo_light" if light else "logo"
    logo = Image.open(base.ASSETS[key]).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (x, y))


def glass_card(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    radius: int = 28,
    fill=(7, 17, 45, 220),
    outline=(103, 232, 249, 105),
):
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (x1, y1 + 14, x2, y2 + 14),
        radius=radius,
        fill=(35, 8, 92, 105),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    canvas.alpha_composite(shadow)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=2)


def screen_frame(
    canvas: Image.Image,
    path: Path,
    box: tuple[int, int, int, int],
    *,
    contain: bool = True,
    crop: tuple[int, int, int, int] | None = None,
    dark: bool = False,
    label: str | None = None,
):
    x1, y1, x2, y2 = box
    draw = ImageDraw.Draw(canvas)
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (x1, y1 + 12, x2, y2 + 12),
        radius=30,
        fill=(15, 23, 42, 72),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shadow)
    draw.rounded_rectangle(
        box,
        radius=30,
        fill="#071029" if dark else "#FFFFFF",
        outline="#54E5F5" if dark else C["line"],
        width=2,
    )
    inner = (x1 + 18, y1 + 18, x2 - 18, y2 - 18)
    if crop:
        base.rounded_image_crop(canvas, path, crop, inner, radius=20)
    else:
        base.rounded_image(canvas, path, inner, radius=20, contain=contain)
    if label:
        label_font = base.font(17, bold=True)
        width = base.text_width(draw, label, label_font) + 34
        draw.rounded_rectangle(
            (x1 + 28, y1 + 28, x1 + 28 + width, y1 + 72),
            radius=22,
            fill="#08132F" if dark else "#F0EBFF",
        )
        draw.text(
            (x1 + 45, y1 + 50),
            label,
            font=label_font,
            fill="#C8F7FF" if dark else C["violet_dark"],
            anchor="lm",
        )


def soft_card(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    title: str,
    body: str,
    *,
    accent: str = "#7C3AED",
    soft: str = "#F3EEFF",
    number: str | None = None,
    body_size: int = 18,
):
    x1, y1, x2, y2 = box
    d = ImageDraw.Draw(canvas)
    base.rounded(d, box, 24, "#FFFFFF", C["line"], 2)
    d.rounded_rectangle((x1, y1, x1 + 10, y2), radius=5, fill=accent)
    text_x = x1 + 28
    if number:
        base.number_badge(d, x1 + 24, y1 + 22, number, accent)
        text_x = x1 + 88
    d.text((text_x, y1 + 24), title, font=base.font(24, bold=True), fill=C["ink"])
    base.draw_paragraph(
        d,
        (text_x, y1 + 68),
        body,
        base.font(body_size),
        C["muted"],
        x2 - text_x - 24,
        line_gap=5,
        max_lines=3,
    )


def path_strip(
    canvas: Image.Image,
    y: int,
    items: list[tuple[str, str]],
    *,
    dark: bool = False,
):
    d = ImageDraw.Draw(canvas)
    available = W - 2 * M
    gap = 14
    item_width = (available - gap * (len(items) - 1)) // len(items)
    for index, (title, caption) in enumerate(items):
        x1 = M + index * (item_width + gap)
        x2 = x1 + item_width
        fill = (9, 20, 51, 225) if dark else "#FFFFFF"
        outline = (124, 58, 237, 130) if dark else C["line"]
        d.rounded_rectangle((x1, y, x2, y + 118), radius=22, fill=fill, outline=outline, width=2)
        d.text(
            (x1 + 18, y + 23),
            title,
            font=base.font(21, bold=True),
            fill="#FFFFFF" if dark else C["ink"],
        )
        base.draw_paragraph(
            d,
            (x1 + 18, y + 62),
            caption,
            base.font(15),
            "#BFD2F6" if dark else C["muted"],
            item_width - 36,
            line_gap=3,
            max_lines=2,
        )


def cover_page() -> Path:
    im = cover_crop(base.ASSETS["hero"], (W, H))
    im = ImageEnhance.Brightness(im).enhance(0.48)
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(H):
        od.line((0, y, W, y), fill=(3, 8, 28, round(232 - 52 * (y / H))))
    od.ellipse((650, 120, 1400, 870), fill=(124, 58, 237, 44))
    od.ellipse((-260, 920, 620, 1790), fill=(34, 211, 238, 34))
    overlay = overlay.filter(ImageFilter.GaussianBlur(64))
    im.alpha_composite(overlay)
    d = ImageDraw.Draw(im)

    add_logo(im, M, 56, 355, light=True)
    base.pill(
        d,
        M,
        174,
        RELEASE,
        "#2D225E",
        "#C8F7FF",
        base.font(19, bold=True),
        pad_x=18,
        h=48,
    )
    base.draw_paragraph(
        d,
        (M, 265),
        "不只回答你\n而是陪你真正学会",
        base.font(65, bold=True),
        "#FFFFFF",
        1050,
        line_gap=13,
    )
    base.draw_paragraph(
        d,
        (M, 475),
        "从外部知识或 Obsidian 项目出发，通过互动课堂、主动练习、"
        "安全沉淀与问题归纳，完成可验证、可继续的学习闭环。",
        base.font(25),
        "#DCE9FF",
        1070,
        line_gap=8,
        max_lines=3,
    )

    screen_frame(
        im,
        base.ASSETS["home_loop"],
        (M, 615, W - M, 1128),
        contain=False,
        crop=(0, 0, 1280, 830),
        dark=True,
        label="同一个目标，贯穿整轮学习",
    )

    path_strip(
        im,
        1165,
        [
            ("学外部", "论文、科研、技术与 GitHub"),
            ("学内部", "单篇笔记或项目文件夹"),
            ("主动验证", "回忆、解释与迁移应用"),
            ("沉淀归纳", "回写、归纳与复习导航"),
        ],
        dark=True,
    )

    qr = base.qr_image(176)
    qr_frame = Image.new("RGBA", (204, 204), "white")
    qr_frame.alpha_composite(qr, (14, 14))
    im.alpha_composite(qr_frame, (W - M - 204, 1433))
    d.text((M, 1458), "知洄 Vaultide", font=base.font(34, bold=True), fill="#FFFFFF")
    d.text((M, 1512), TAGLINE, font=base.font(23, bold=True), fill="#BDF5FF")
    d.text((M, 1572), URL, font=base.font(17), fill="#DCE9FF")
    d.text(
        (W - M - 102, 1673),
        "扫码进入网页课堂",
        font=base.font(16, bold=True),
        fill="#BDF5FF",
        anchor="mm",
    )
    return base.save_page(im, 1)


def page_2() -> Path:
    im = base.gradient_background("#FAFBFF", "#F1EDFF")
    manual_header(im, 2, "整体产品")
    y = base.title_block(
        im,
        "不是三个工具，而是同一个学习项目",
        "外部学习、内部学习与知识归纳共享同一目标、证据、掌握度和复习计划。",
    )
    d = ImageDraw.Draw(im)
    modes = [
        ("01", "学习外部新知识", "检索论文、科研、技术、GitHub 与权威网页。", "#2563EB", "#EAF2FF"),
        ("02", "学习 Obsidian 内容", "从一份笔记或整个项目文件夹进入课堂。", "#7C3AED", "#F3EEFF"),
        ("03", "内部知识 + 外部补充", "先发现个人知识缺口，再定向补充外部证据。", "#06B6D4", "#E8FAFC"),
    ]
    card_y = y + 38
    for index, (n, title, body, accent, soft) in enumerate(modes):
        x1 = M + index * 372
        base.shadow_card(im, (x1, card_y, x1 + 350, card_y + 250), radius=26, fill=soft)
        base.number_badge(d, x1 + 22, card_y + 22, n, accent)
        d.text((x1 + 88, card_y + 26), title, font=base.font(23, bold=True), fill=C["ink"])
        base.draw_paragraph(
            d,
            (x1 + 24, card_y + 92),
            body,
            base.font(18),
            C["muted"],
            302,
            line_gap=6,
            max_lines=4,
        )
        d.rounded_rectangle(
            (x1 + 24, card_y + 186, x1 + 326, card_y + 220),
            radius=17,
            fill=accent,
        )

    loop_y = card_y + 318
    d.text((M, loop_y), "一轮完整学习闭环", font=base.font(31, bold=True), fill=C["ink"])
    labels = ["目标", "证据", "课堂", "验证", "沉淀", "归纳", "复习"]
    arrow_y = loop_y + 100
    usable = W - 2 * M
    node_w = 132
    gap = (usable - node_w * len(labels)) // (len(labels) - 1)
    for index, label in enumerate(labels):
        x = M + index * (node_w + gap)
        color = ["#7C3AED", "#2563EB", "#06B6D4", "#10B981", "#F59E0B", "#EC4899", "#6366F1"][index]
        d.rounded_rectangle((x, arrow_y, x + node_w, arrow_y + 92), radius=24, fill="#FFFFFF", outline=color, width=3)
        d.text((x + node_w // 2, arrow_y + 46), label, font=base.font(23, bold=True), fill=color, anchor="mm")
        if index < len(labels) - 1:
            ax = x + node_w + 6
            d.line((ax, arrow_y + 46, ax + gap - 12, arrow_y + 46), fill="#A6B1CB", width=4)
            d.polygon(
                [
                    (ax + gap - 18, arrow_y + 37),
                    (ax + gap - 4, arrow_y + 46),
                    (ax + gap - 18, arrow_y + 55),
                ],
                fill="#A6B1CB",
            )

    screen_frame(
        im,
        base.ASSETS["home_loop"],
        (M, 1035, W - M, 1532),
        contain=False,
        crop=(0, 0, 1280, 880),
        label="首页先定义“学完后能够做什么”",
    )
    base.footer(im)
    return base.save_page(im, 2)


def page_3() -> Path:
    im = base.gradient_background("#FBFDFF", "#EEF5FF")
    manual_header(im, 3, "外部知识学习")
    y = base.title_block(
        im,
        "怎么学习外部的新知识？",
        "把“帮我搜一下”升级成“围绕真实目标，建立一堂有来源、有练习、有结论的课”。",
    )
    d = ImageDraw.Draw(im)
    sources = ["最新论文", "科研与前沿文章", "新技术与官方文档", "GitHub 仓库"]
    for index, label in enumerate(sources):
        x1 = M + index * 278
        base.pill(
            d,
            x1,
            y + 24,
            label,
            "#EAF2FF",
            "#2457B8",
            base.font(18, bold=True),
            pad_x=17,
            h=44,
        )

    steps = [
        ("1", "先写结果型目标", "例如：比较三种方案，并设计一个可验证实验。"),
        ("2", "选择“学习外部新知识”", "系统默认优先原始来源与权威资料。"),
        ("3", "检索并保留证据", "记录标题、链接、来源类型和实际使用范围。"),
        ("4", "进入互动课堂", "课堂围绕目标组织解释、提问、测验与迁移任务。"),
    ]
    sy = y + 105
    for index, (n, title, body) in enumerate(steps):
        row = index // 2
        col = index % 2
        x1 = M + col * 568
        y1 = sy + row * 150
        soft_card(
            im,
            (x1, y1, x1 + 540, y1 + 128),
            title,
            body,
            accent="#2563EB",
            number=n,
            body_size=17,
        )

    screen_frame(
        im,
        base.ASSETS["external"],
        (M, sy + 325, W - M, 1440),
        contain=True,
        label="外部模式：目标、基础、完成标准与检索一起进入课堂",
    )
    d.rounded_rectangle((M, 1470, W - M, 1570), radius=22, fill="#EAF2FF")
    d.text((M + 24, 1492), "学习结果", font=base.font(21, bold=True), fill="#2457B8")
    base.draw_paragraph(
        d,
        (M + 150, 1489),
        "来源可追溯，课堂可交互，练习可验证，最后可沉淀到 Obsidian。",
        base.font(19),
        C["ink"],
        900,
        line_gap=4,
        max_lines=2,
    )
    base.footer(im)
    return base.save_page(im, 3)


def page_4() -> Path:
    im = base.gradient_background("#FCFBFF", "#F2EEFF")
    manual_header(im, 4, "Obsidian 内部学习")
    y = base.title_block(
        im,
        "怎么学习 Obsidian 里的笔记或项目？",
        "本地负责选择和授权，网页负责课堂学习；原笔记保持只读。",
    )
    d = ImageDraw.Draw(im)
    commands = [
        ("单篇笔记", CMD_NOTE),
        ("项目文件夹", CMD_FOLDER),
    ]
    cy = y + 28
    for index, (label, command) in enumerate(commands):
        y1 = cy + index * 92
        d.rounded_rectangle((M, y1, W - M, y1 + 74), radius=20, fill="#111B3C")
        d.text((M + 22, y1 + 18), label, font=base.font(18, bold=True), fill="#BDF5FF")
        d.text((M + 175, y1 + 37), command, font=base.font(18, mono=True), fill="#FFFFFF", anchor="lm")

    steps = [
        ("1", "本地选择", "选择当前 Markdown 或整个项目文件夹。"),
        ("2", "一次授权", "预览文件范围、排除项和目标绑定。"),
        ("3", "生成课堂", "相关片段被冻结为可追溯来源版本。"),
        ("4", "继续学习", "进度、主动证据和复习计划持续累积。"),
    ]
    sy = cy + 205
    for index, (n, title, body) in enumerate(steps):
        x1 = M + index * 278
        base.shadow_card(im, (x1, sy, x1 + 260, sy + 188), radius=24, fill="#FFFFFF")
        base.number_badge(d, x1 + 18, sy + 18, n, "#7C3AED")
        d.text((x1 + 82, sy + 22), title, font=base.font(22, bold=True), fill=C["ink"])
        base.draw_paragraph(
            d,
            (x1 + 20, sy + 88),
            body,
            base.font(17),
            C["muted"],
            220,
            line_gap=5,
            max_lines=3,
        )

    screen_frame(
        im,
        base.ASSETS["obsidian_guide"],
        (M, sy + 235, W - M, 1475),
        contain=True,
        label="Obsidian 使用引导：配对、选择、上传、回到网页",
    )
    d.text(
        (M, 1522),
        "关键边界：网页不能直接读取整个 Vault；只有你批准的笔记或文件夹会进入本轮学习。",
        font=base.font(19, bold=True),
        fill=C["violet_dark"],
    )
    base.footer(im)
    return base.save_page(im, 4)


def page_5() -> Path:
    im = base.gradient_background("#FBFCFF", "#F1F8FF")
    manual_header(im, 5, "主动学习")
    y = base.title_block(
        im,
        "产品怎么帮助你真正学会？",
        "浏览只记录进度；回忆、解释、迁移与测验才形成掌握证据。",
    )
    d = ImageDraw.Draw(im)
    methods = [
        ("闭卷回忆", "不看课件，提取要点和仍不确定的问题。", "#7C3AED"),
        ("费曼解释", "用自己的话讲清机制、边界与常见误区。", "#06B6D4"),
        ("迁移应用", "把方法用于新的真实情境，并记录结果。", "#10B981"),
    ]
    card_y = y + 32
    for index, (title, body, accent) in enumerate(methods):
        x1 = M + index * 372
        soft_card(
            im,
            (x1, card_y, x1 + 350, card_y + 190),
            title,
            body,
            accent=accent,
            body_size=18,
        )

    screen_frame(
        im,
        base.ASSETS["active_practice"],
        (M, card_y + 235, W - M, 1285),
        contain=True,
        label="课堂内主动练习：选择知识点与验证方式",
    )
    d.rounded_rectangle((M, 1325, W - M, 1555), radius=26, fill="#FFFFFF", outline=C["line"], width=2)
    d.text((M + 26, 1352), "掌握度不是“看完比例”", font=base.font(28, bold=True), fill=C["ink"])
    contrasts = [
        ("只看完 / 手动勾选", "只更新进度", "#94A3B8"),
        ("测验 / 回忆 / 解释 / 迁移", "更新掌握证据", "#10B981"),
        ("同一题反复提交", "自动降低证据权重", "#F59E0B"),
    ]
    for index, (left, right, color) in enumerate(contrasts):
        yy = 1412 + index * 48
        d.ellipse((M + 28, yy + 7, M + 42, yy + 21), fill=color)
        d.text((M + 58, yy), left, font=base.font(18, bold=True), fill=C["ink"])
        d.text((M + 530, yy), right, font=base.font(18), fill=C["muted"])
    base.footer(im)
    return base.save_page(im, 5)


def page_6() -> Path:
    im = base.gradient_background("#FFFCF7", "#F5F0FF")
    manual_header(im, 6, "安全沉淀")
    y = base.title_block(
        im,
        "学习结果怎么沉淀到 Obsidian？",
        "一份原有笔记保持不变，一份伴随笔记持续更新；写入必须经过双重确认。",
    )
    d = ImageDraw.Draw(im)

    note_y = y + 26
    soft_card(
        im,
        (M, note_y, M + 535, note_y + 220),
        "原有笔记 · 只读来源",
        "保留你的原始内容、结构与编辑习惯。知洄引用它，但不会静默追加 AI 内容。",
        accent="#2563EB",
        soft="#EAF2FF",
    )
    soft_card(
        im,
        (M + 565, note_y, W - M, note_y + 220),
        "伴随笔记 · 可变更学习层",
        "保存课堂目标、来源、主动证据、学习进度、总结、复习与迁移任务。",
        accent="#7C3AED",
        soft="#F3EEFF",
    )
    d.line((W // 2, note_y + 235, W // 2, note_y + 294), fill="#A6B1CB", width=4)
    d.polygon(
        [(W // 2 - 10, note_y + 286), (W // 2, note_y + 302), (W // 2 + 10, note_y + 286)],
        fill="#A6B1CB",
    )
    d.rounded_rectangle((M + 185, note_y + 305, W - M - 185, note_y + 385), radius=24, fill="#111B3C")
    d.text(
        (W // 2, note_y + 345),
        "网页预览与批准  +  Obsidian 最终确认",
        font=base.font(23, bold=True),
        fill="#FFFFFF",
        anchor="mm",
    )

    screen_frame(
        im,
        base.ASSETS["writeback_new"],
        (M, note_y + 430, W - M, 1370),
        contain=True,
        label="回写草稿先解释将写入哪里、为什么写入",
    )
    d.text((M, 1415), "默认沉淀目录", font=base.font(25, bold=True), fill=C["ink"])
    folders = [
        "Vaultide/伴随笔记/",
        "Vaultide/学习记录/",
        "Vaultide/归纳/",
        "Vaultide/系统/索引/",
    ]
    for index, folder in enumerate(folders):
        x1 = M + (index % 2) * 560
        y1 = 1460 + (index // 2) * 60
        d.rounded_rectangle((x1, y1, x1 + 530, y1 + 46), radius=18, fill="#FFFFFF", outline=C["line"], width=2)
        d.text((x1 + 18, y1 + 23), folder, font=base.font(17, mono=True), fill=C["violet_dark"], anchor="lm")
    base.footer(im)
    return base.save_page(im, 6)


def page_7() -> Path:
    im = base.gradient_background("#FAFCFF", "#EFFBFA")
    manual_header(im, 7, "问题驱动归纳")
    y = base.title_block(
        im,
        "怎么把多次学习归纳成可用结论？",
        "先提出一个要回答的问题，再让课堂、来源、Obsidian 与掌握证据共同形成结论。",
    )
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((M, y + 28, W - M, y + 132), radius=24, fill="#E8FAFC", outline="#83E4EA", width=2)
    d.text((M + 24, y + 52), "示例问题", font=base.font(18, bold=True), fill="#087A83")
    base.draw_paragraph(
        d,
        (M + 154, y + 45),
        "学习最新的智能体记忆架构，比较主流方案，并设计一个可验证的小型实验。",
        base.font(22, bold=True),
        C["ink"],
        930,
        line_gap=5,
        max_lines=2,
    )

    outputs = [
        ("范围", "使用哪些项目、课堂、来源与时间段"),
        ("结论", "只使用当前范围内的可追溯证据"),
        ("连接", "跨课堂关系、共同机制与适用边界"),
        ("行动", "薄弱区域、复习与下一轮迁移任务"),
    ]
    oy = y + 170
    for index, (title, body) in enumerate(outputs):
        x1 = M + index * 278
        soft_card(
            im,
            (x1, oy, x1 + 260, oy + 172),
            title,
            body,
            accent=["#7C3AED", "#2563EB", "#06B6D4", "#10B981"][index],
            body_size=16,
        )

    screen_frame(
        im,
        base.ASSETS["question_synthesis"],
        (M, oy + 220, W - M, 1490),
        contain=False,
        crop=(0, 0, 1280, 980),
        label="问题进入归纳标题、证据范围和下一步学习建议",
    )
    d.text(
        (M, 1535),
        "归纳不是“把所有内容再总结一次”，而是回答一个具体问题，并指出下一步。",
        font=base.font(20, bold=True),
        fill="#087A83",
    )
    base.footer(im)
    return base.save_page(im, 7)


def page_8() -> Path:
    im = base.gradient_background("#F7F9FF", "#F2EEFF")
    manual_header(im, 8, "多维知识逻辑空间")
    y = base.title_block(
        im,
        "多维空间如何真正服务学习？",
        "关系图是结论的解释层：用问题选择透镜，用知识簇缩小范围，用证据回查来源。",
    )
    d = ImageDraw.Draw(im)
    lenses = [
        ("逻辑链", "下一步应该沿哪条学习路径继续？", "#7C3AED"),
        ("主题岛", "方案、项目与知识板块如何聚合？", "#06B6D4"),
        ("来源流", "资料是否转化为课堂、理解和笔记？", "#F59E0B"),
        ("时间演化", "知识在何时形成，哪些区域正在增强？", "#2563EB"),
    ]
    ly = y + 26
    for index, (title, body, color) in enumerate(lenses):
        x1 = M + (index % 2) * 568
        y1 = ly + (index // 2) * 122
        soft_card(
            im,
            (x1, y1, x1 + 540, y1 + 102),
            title,
            body,
            accent=color,
            body_size=16,
        )

    screen_frame(
        im,
        base.ASSETS["knowledge_space"],
        (M, ly + 285, W - M, 1375),
        contain=True,
        label="比较型问题自动推荐“主题岛”视角",
    )
    steps = [
        ("1", "先看系统推荐", "问题决定默认透镜"),
        ("2", "点击知识簇", "只观察簇内节点和关系"),
        ("3", "回查证据", "返回来源、课堂或笔记"),
    ]
    sy = 1415
    for index, (n, title, body) in enumerate(steps):
        x1 = M + index * 372
        base.shadow_card(im, (x1, sy, x1 + 350, sy + 145), radius=22, fill="#FFFFFF")
        base.number_badge(d, x1 + 18, sy + 18, n, "#7C3AED")
        d.text((x1 + 82, sy + 20), title, font=base.font(21, bold=True), fill=C["ink"])
        d.text((x1 + 82, sy + 68), body, font=base.font(16), fill=C["muted"])
    base.footer(im)
    return base.save_page(im, 8)


def page_9() -> Path:
    im = base.gradient_background("#FBFCFF", "#F1F7FF")
    manual_header(im, 9, "长期使用")
    y = base.title_block(
        im,
        "把知洄变成你的长期学习系统",
        "少做一次性生成，多做目标明确、证据可查、能够继续的学习循环。",
    )
    d = ImageDraw.Draw(im)
    routines = [
        ("每次学习", "一个真实问题", "明确学完后能做什么；只纳入与目标相关的来源。", "#7C3AED"),
        ("课堂结束", "一次主动验证", "至少完成闭卷回忆、费曼解释或迁移应用中的一种。", "#10B981"),
        ("每天收尾", "一次安全沉淀", "预览回写草稿，在 Obsidian 确认伴随笔记与学习记录。", "#F59E0B"),
        ("每周复盘", "一个归纳问题", "按时间、板块或项目回答具体问题，生成下一步复习。", "#2563EB"),
    ]
    ry = y + 32
    for index, (cadence, title, body, color) in enumerate(routines):
        y1 = ry + index * 190
        d.rounded_rectangle((M, y1, W - M, y1 + 160), radius=26, fill="#FFFFFF", outline=C["line"], width=2)
        d.rounded_rectangle((M, y1, M + 190, y1 + 160), radius=26, fill=color)
        d.text((M + 95, y1 + 80), cadence, font=base.font(23, bold=True), fill="#FFFFFF", anchor="mm")
        d.text((M + 222, y1 + 28), title, font=base.font(26, bold=True), fill=C["ink"])
        base.draw_paragraph(
            d,
            (M + 222, y1 + 78),
            body,
            base.font(19),
            C["muted"],
            850,
            line_gap=5,
            max_lines=2,
        )

    d.rounded_rectangle((M, 1115, W - M, 1538), radius=28, fill="#0B1635")
    d.text((M + 28, 1146), "判断学习闭环是否成立", font=base.font(30, bold=True), fill="#FFFFFF")
    checks = [
        "来源是否可追溯？",
        "是否产生了主动学习证据？",
        "原笔记与 AI 伴随内容是否分离？",
        "进度能否在下一次打开时继续？",
        "归纳是否回答了一个具体问题？",
        "系统是否给出可执行的下一步？",
    ]
    for index, item in enumerate(checks):
        col = index % 2
        row = index // 2
        x1 = M + 30 + col * 550
        y1 = 1218 + row * 88
        d.ellipse((x1, y1 + 7, x1 + 18, y1 + 25), fill="#22D3EE")
        d.text((x1 + 34, y1), item, font=base.font(19, bold=True), fill="#DCE9FF")
    base.footer(im)
    return base.save_page(im, 9)


def page_10() -> Path:
    im = base.gradient_background("#FBFCFF", "#F3EEFF")
    manual_header(im, 10, "快速开始")
    y = base.title_block(
        im,
        "第一次使用：从一个真实问题开始",
        "网页是主要学习场景；Obsidian 负责本地选择、最终确认与长期知识管理。",
    )
    d = ImageDraw.Draw(im)
    steps = [
        ("1", "打开正式网页", "输入站点访问码，先写“学完后能够做什么”。"),
        ("2", "选择学习来源", "外部、Obsidian，或内部知识 + 外部补充。"),
        ("3", "进入课堂并主动验证", "完成回忆、解释、测验或迁移应用。"),
        ("4", "沉淀到 Obsidian", f"执行：{CMD_WRITEBACK}"),
        ("5", "提出归纳问题", "用当前证据回答，并选择合适的关系空间。"),
    ]
    sy = y + 28
    for index, (n, title, body) in enumerate(steps):
        base.step_card(
            im,
            (M, sy + index * 133, W - M, sy + index * 133 + 112),
            n,
            title,
            body,
            "#7C3AED",
            "#F3EEFF",
        )

    qy = sy + 5 * 133 + 18
    d.rounded_rectangle((M, qy, W - M, 1535), radius=28, fill="#0B1635")
    qr = base.qr_image(218)
    qr_frame = Image.new("RGBA", (246, 246), "#FFFFFF")
    qr_frame.alpha_composite(qr, (14, 14))
    im.alpha_composite(qr_frame, (M + 28, qy + 34))
    d.text((M + 310, qy + 44), "正式访问地址", font=base.font(20, bold=True), fill="#BDF5FF")
    d.text((M + 310, qy + 92), URL, font=base.font(23, bold=True), fill="#FFFFFF")
    d.text((M + 310, qy + 150), "Obsidian 设备配对", font=base.font(20, bold=True), fill="#BDF5FF")
    base.draw_paragraph(
        d,
        (M + 310, qy + 192),
        "网页生成 10 分钟有效的六位码，填入插件设置并完成 Pair。",
        base.font(18),
        "#DCE9FF",
        780,
        line_gap=5,
        max_lines=2,
    )
    d.text(
        (M + 28, 1582),
        "知洄 Vaultide 基于 OpenMAIC 构建，通过独立连接器与 Obsidian 协同；"
        "不是 OpenMAIC 或 Obsidian 官方产品。",
        font=base.font(15),
        fill=C["muted"],
    )
    base.footer(im)
    return base.save_page(im, 10)


def create_pdf(page_paths: list[Path]) -> Path:
    images = [Image.open(path).convert("RGB") for path in page_paths]
    pdf_path = OUT / "知洄-Vaultide-2026.07-整体学习闭环版-宣传使用手册.pdf"
    images[0].save(
        pdf_path,
        save_all=True,
        append_images=images[1:],
        resolution=150.0,
        quality=95,
    )
    return pdf_path


def create_contact_sheet(page_paths: list[Path]) -> Path:
    thumb_w = 300
    thumb_h = round(thumb_w * H / W)
    gap = 20
    cols = 5
    rows = 2
    sheet = Image.new(
        "RGB",
        (cols * thumb_w + (cols + 1) * gap, rows * thumb_h + (rows + 1) * gap),
        "#091126",
    )
    for index, path in enumerate(page_paths):
        image = Image.open(path).convert("RGB")
        image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = gap + (index % cols) * (thumb_w + gap)
        y = gap + (index // cols) * (thumb_h + gap)
        sheet.paste(image, (x, y))
    path = OUT / "manual-contact-sheet.png"
    sheet.save(path, quality=95)
    return path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PAGES.mkdir(parents=True, exist_ok=True)
    PDF_OUT.mkdir(parents=True, exist_ok=True)
    missing = [str(path) for path in base.ASSETS.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing assets:\n" + "\n".join(missing))

    builders = [
        cover_page,
        page_2,
        page_3,
        page_4,
        page_5,
        page_6,
        page_7,
        page_8,
        page_9,
        page_10,
    ]
    page_paths = [builder() for builder in builders]
    poster_path = OUT / "知洄-Vaultide-2026.07-整体学习闭环版-宣传海报.png"
    shutil.copy2(page_paths[0], poster_path)
    pdf_path = create_pdf(page_paths)
    contact_sheet = create_contact_sheet(page_paths)
    qr_path = OUT / "知洄-Vaultide-正式网页二维码.png"
    base.qr_image(600).convert("RGB").save(qr_path, quality=100)
    shutil.copy2(pdf_path, PDF_OUT / pdf_path.name)

    manifest = {
        "product": "知洄 Vaultide",
        "release": RELEASE,
        "tagline": TAGLINE,
        "positioning": "连接外部知识、Obsidian、互动课堂、主动学习证据与问题归纳的个人智能学习系统",
        "url": URL,
        "outputs": {
            "poster": poster_path.name,
            "manualPdf": pdf_path.name,
            "manualContactSheet": contact_sheet.name,
            "qr": qr_path.name,
            "pages": [path.relative_to(OUT).as_posix() for path in page_paths],
        },
        "exactCommands": [CMD_NOTE, CMD_FOLDER, CMD_WRITEBACK],
        "sourceAssets": {
            key: str(path.relative_to(ROOT))
            for key, path in base.ASSETS.items()
            if path.is_relative_to(ROOT)
        },
        "notes": [
            "产品界面使用 2026-07-25 同版本后台浏览器验收截图。",
            "品牌标识、产品文案、命令、网址与二维码使用确定性排版。",
            "原笔记只读、双重确认和伴随笔记为已实现产品边界。",
            "多维空间定位为归纳结论的解释与探索层，不替代文字结论和证据。",
        ],
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "provenance.md").write_text(
        "\n".join(
            [
                "# 新版宣传物来源与边界",
                "",
                "- 品牌：知洄 Vaultide 独立品牌。",
                "- 技术来源：基于 OpenMAIC 构建，通过独立连接器与 Obsidian 协同。",
                "- 产品截图：2026-07-25 已验收版本。",
                "- 排版：Pillow 确定性生成，A4 竖版 1240 × 1754。",
                "- 叙事：目标、证据、课堂、验证、沉淀、归纳、复习。",
                "- 不包含价格、认证、用户评价或未实现功能。",
                f"- 正式地址：{URL}",
                f"- 单篇笔记命令：`{CMD_NOTE}`",
                f"- 项目文件夹命令：`{CMD_FOLDER}`",
                f"- 回写命令：`{CMD_WRITEBACK}`",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(json.dumps(manifest["outputs"], ensure_ascii=False))


if __name__ == "__main__":
    main()
