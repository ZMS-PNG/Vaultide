from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas as pdf_canvas


ROOT = Path(__file__).resolve().parents[1]
BASE_SCRIPT = ROOT / "scripts" / "create_openmaic_manual.py"
OUT = ROOT / "output" / "vaultide-first-use-2026.07"
PAGES = OUT / "pages"
PDF_OUT = ROOT / "output" / "pdf"
URL = "https://openmaic-eight-eosin.vercel.app"
PAIRING_URL = f"{URL}/learning-pairing"
RELEASE = "2026.07 首次使用版"
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
        "home_first": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-project-home.png",
        "external": ROOT
        / "output"
        / "playwright"
        / "holistic-product-audit"
        / "02-external-learning-entry.png",
        "active": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-active-practice-final.png",
        "pairing_new": ROOT
        / "output"
        / "playwright"
        / "ux-optimized"
        / "05-pairing-optimized.png",
        "obsidian_guide_new": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-obsidian-guide.png",
        "writeback_new": ROOT
        / "output"
        / "playwright"
        / "ux-optimized"
        / "04-writeback-optimized.png",
        "synthesis": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-question-synthesis.png",
        "knowledge_space": ROOT
        / "output"
        / "playwright"
        / "holistic-learning-space-final.png",
    }
)

W, H, M = base.W, base.H, base.M
C = base.COLORS


def header(canvas: Image.Image, page_no: int, section: str):
    draw = ImageDraw.Draw(canvas)
    base.add_logo(canvas, M, 42, 300)
    draw.text(
        (W - M, 58),
        f"{page_no:02d}  /  08",
        font=base.font(23, bold=True),
        fill=C["muted"],
        anchor="ra",
    )
    draw.text(
        (W - M, 96),
        section,
        font=base.font(20),
        fill=C["violet"],
        anchor="ra",
    )


def screen_frame(
    canvas: Image.Image,
    path: Path,
    box: tuple[int, int, int, int],
    *,
    contain: bool = True,
    crop: tuple[int, int, int, int] | None = None,
    label: str | None = None,
):
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle(
        (x1, y1 + 13, x2, y2 + 13),
        radius=30,
        fill=(21, 31, 72, 66),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    canvas.alpha_composite(shadow)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        box,
        radius=30,
        fill="#FFFFFF",
        outline=C["line"],
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
            fill="#F0E9FF",
        )
        draw.text(
            (x1 + 45, y1 + 50),
            label,
            font=label_font,
            fill=C["violet_dark"],
            anchor="lm",
        )


def soft_card(
    canvas: Image.Image,
    box: tuple[int, int, int, int],
    title: str,
    body: str,
    *,
    accent: str = "#7C3AED",
    number: str | None = None,
    title_size: int = 24,
    body_size: int = 18,
):
    x1, y1, x2, y2 = box
    base.shadow_card(canvas, box, radius=24, shadow_alpha=14)
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((x1, y1, x1 + 9, y2), radius=5, fill=accent)
    text_x = x1 + 28
    if number:
        base.number_badge(draw, x1 + 22, y1 + 22, number, accent)
        text_x = x1 + 86
    draw.text(
        (text_x, y1 + 24),
        title,
        font=base.font(title_size, bold=True),
        fill=C["ink"],
    )
    base.draw_paragraph(
        draw,
        (text_x, y1 + 67),
        body,
        base.font(body_size),
        C["muted"],
        x2 - text_x - 25,
        line_gap=5,
        max_lines=3,
    )


def command_box(
    canvas: Image.Image,
    y: int,
    label: str,
    command: str,
    *,
    height: int = 105,
):
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (M, y, W - M, y + height),
        radius=20,
        fill="#0B1635",
    )
    draw.text(
        (M + 24, y + 18),
        label,
        font=base.font(17, bold=True),
        fill="#BDF5FF",
    )
    draw.text(
        (M + 24, y + 61),
        command,
        font=base.font(19, mono=True),
        fill="#FFFFFF",
    )


def cover_page() -> Path:
    hero = Image.open(base.ASSETS["hero"]).convert("RGBA")
    scale = max(W / hero.width, H / hero.height)
    hero = hero.resize(
        (round(hero.width * scale), round(hero.height * scale)),
        Image.Resampling.LANCZOS,
    )
    left = max(0, (hero.width - W) // 2)
    top = max(0, (hero.height - H) // 2)
    image = hero.crop((left, top, left + W, top + H))
    image = ImageEnhance.Brightness(image).enhance(0.48)
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    overlay_draw.rectangle((0, 0, W, H), fill=(4, 10, 32, 178))
    overlay_draw.ellipse((600, 100, 1370, 870), fill=(124, 58, 237, 48))
    overlay_draw.ellipse((-250, 1000, 600, 1850), fill=(8, 190, 220, 35))
    overlay = overlay.filter(ImageFilter.GaussianBlur(56))
    image.alpha_composite(overlay)
    draw = ImageDraw.Draw(image)

    logo = Image.open(base.ASSETS["logo_light"]).convert("RGBA")
    ratio = 380 / logo.width
    logo = logo.resize(
        (380, round(logo.height * ratio)),
        Image.Resampling.LANCZOS,
    )
    image.alpha_composite(logo, (M, 58))
    base.pill(
        draw,
        M,
        182,
        RELEASE,
        "#2C245F",
        "#C8F7FF",
        base.font(19, bold=True),
        pad_x=18,
        h=48,
    )
    base.draw_paragraph(
        draw,
        (M, 276),
        "第一次使用知洄？\n3 分钟开始第一堂课",
        base.font(62, bold=True),
        "#FFFFFF",
        1080,
        line_gap=15,
    )
    base.draw_paragraph(
        draw,
        (M, 485),
        "先在网页完成一堂外部学习课。确认它对你有用以后，再连接 Obsidian。",
        base.font(27),
        "#DDEAFF",
        1050,
        line_gap=8,
        max_lines=3,
    )

    screen_frame(
        image,
        base.ASSETS["home_first"],
        (M, 640, W - M, 1195),
        contain=False,
        crop=(0, 0, 1280, 850),
        label="第一步：先写清“学完后能够做什么”",
    )
    cards = [
        ("1", "先上网页首课", "第一次不需要安装插件"),
        ("2", "再连接 Obsidian", "确认产品价值之后再配对"),
        ("3", "最后归纳复习", "累积多堂课后再看关系"),
    ]
    for index, (number, title, body) in enumerate(cards):
        x1 = M + index * 372
        draw.rounded_rectangle(
            (x1, 1235, x1 + 350, 1408),
            radius=25,
            fill=(8, 20, 50, 220),
            outline=(120, 224, 245, 80),
            width=2,
        )
        base.number_badge(draw, x1 + 20, 1255, number, "#7C3AED")
        draw.text(
            (x1 + 84, 1259),
            title,
            font=base.font(22, bold=True),
            fill="#FFFFFF",
        )
        base.draw_paragraph(
            draw,
            (x1 + 24, 1325),
            body,
            base.font(17),
            "#BDD0F3",
            300,
            line_gap=4,
            max_lines=2,
        )

    qr = base.qr_image(190)
    qr_frame = Image.new("RGBA", (218, 218), "#FFFFFF")
    qr_frame.alpha_composite(qr, (14, 14))
    image.alpha_composite(qr_frame, (W - M - 218, 1450))
    draw.text(
        (M, 1476),
        "知洄 Vaultide",
        font=base.font(33, bold=True),
        fill="#FFFFFF",
    )
    draw.text(
        (M, 1530),
        "让每次学习，流回你的知识库",
        font=base.font(23, bold=True),
        fill="#BDF5FF",
    )
    draw.text((M, 1590), URL, font=base.font(18), fill="#DCE9FF")
    draw.text(
        (W - M - 109, 1683),
        "扫码进入网页课堂",
        font=base.font(16, bold=True),
        fill="#BDF5FF",
        anchor="mm",
    )
    return base.save_page(image, 1)


def page_2() -> Path:
    image = base.gradient_background("#FBFCFF", "#F2EEFF")
    header(image, 2, "访问与配对")
    y = base.title_block(
        image,
        "先认清两种码，避免卡在入口",
        "站点访问码用于进入网页；六位配对码只用于连接 Obsidian。它们不是同一个码。",
    )
    draw = ImageDraw.Draw(image)
    card_y = y + 34
    soft_card(
        image,
        (M, card_y, M + 535, card_y + 285),
        "站点访问码",
        "固定访问门槛。当前私人部署由产品所有者提供；自己部署时在 Vercel 环境变量 ACCESS_CODE 中配置。",
        accent="#2563EB",
        title_size=30,
        body_size=20,
    )
    draw.rounded_rectangle(
        (M + 28, card_y + 210, M + 507, card_y + 252),
        radius=18,
        fill="#EAF2FF",
    )
    draw.text(
        (M + 48, card_y + 231),
        "用途：进入网页",
        font=base.font(18, bold=True),
        fill="#2457B8",
        anchor="lm",
    )
    soft_card(
        image,
        (M + 565, card_y, W - M, card_y + 285),
        "六位配对码",
        "网页在连接页面临时生成。10 分钟有效、只能使用一次，只负责让 Obsidian 插件获得设备令牌。",
        accent="#7C3AED",
        title_size=30,
        body_size=20,
    )
    draw.rounded_rectangle(
        (M + 593, card_y + 210, W - M - 28, card_y + 252),
        radius=18,
        fill="#F0E9FF",
    )
    draw.text(
        (M + 613, card_y + 231),
        "用途：连接 Obsidian",
        font=base.font(18, bold=True),
        fill=C["violet_dark"],
        anchor="lm",
    )

    draw.rounded_rectangle(
        (M, card_y + 330, W - M, card_y + 442),
        radius=24,
        fill="#0B1635",
    )
    draw.text(
        (M + 26, card_y + 352),
        "第一次使用的正确顺序",
        font=base.font(19, bold=True),
        fill="#BDF5FF",
    )
    draw.text(
        (M + 26, card_y + 399),
        "输入站点访问码 → 完成第一堂网页课 → 再生成六位码连接 Obsidian",
        font=base.font(24, bold=True),
        fill="#FFFFFF",
    )
    screen_frame(
        image,
        base.ASSETS["pairing_new"],
        (M, card_y + 490, W - M, 1515),
        contain=False,
        crop=(240, 40, 1040, 680),
        label="六位码只在“连接 Obsidian”时生成",
    )
    base.footer(image)
    return base.save_page(image, 2)


def page_3() -> Path:
    image = base.gradient_background("#FBFDFF", "#EDF5FF")
    header(image, 3, "第一堂网页课")
    y = base.title_block(
        image,
        "第一次只做一件事：完成一堂外部学习课",
        "不安装插件也能体验核心价值。先把一个真实问题变成有来源、有讲解、有练习的课堂。",
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (M, y + 32, W - M, y + 160),
        radius=24,
        fill="#EAF2FF",
        outline="#BCD2FF",
        width=2,
    )
    draw.text(
        (M + 26, y + 54),
        "可以直接复制这个目标",
        font=base.font(18, bold=True),
        fill="#2457B8",
    )
    base.draw_paragraph(
        draw,
        (M + 26, y + 95),
        "我想理解 AI Agent 的记忆系统，比较三种主流方案，并判断哪一种适合个人知识库。",
        base.font(23, bold=True),
        C["ink"],
        W - 2 * M - 52,
        line_gap=5,
        max_lines=2,
    )

    options = [
        ("1", "学习路径", "学习外部新知识", "#2563EB"),
        ("2", "学习结果", "比较并判断", "#7C3AED"),
        ("3", "当前基础", "第一次学习", "#06B6D4"),
    ]
    options_y = y + 195
    for index, (number, title, body, color) in enumerate(options):
        x1 = M + index * 372
        soft_card(
            image,
            (x1, options_y, x1 + 350, options_y + 160),
            title,
            body,
            accent=color,
            number=number,
            title_size=22,
            body_size=20,
        )

    screen_frame(
        image,
        base.ASSETS["external"],
        (M, options_y + 205, W - M, 1468),
        contain=True,
        label="点击“准备外部证据并进入课堂”",
    )
    draw.rounded_rectangle(
        (M, 1505, W - M, 1593),
        radius=22,
        fill="#E8FAF3",
    )
    draw.text(
        (M + 24, 1549),
        "成功标准：看到可追溯来源、进入课堂，并完成至少一次主动练习。",
        font=base.font(20, bold=True),
        fill="#087C5B",
        anchor="lm",
    )
    base.footer(image)
    return base.save_page(image, 3)


def page_4() -> Path:
    image = base.gradient_background("#FBFCFF", "#EFFBFA")
    header(image, 4, "课堂内怎么学")
    y = base.title_block(
        image,
        "不要只看讲解，要留下掌握证据",
        "看完只代表进度；能够回忆、解释和迁移，才说明知识开始真正属于你。",
    )
    methods = [
        ("1", "看来源", "先确认资料从哪里来、为什么可信。", "#2563EB"),
        ("2", "追问", "遇到不懂的概念，立即要求换一种方式解释。", "#7C3AED"),
        ("3", "闭卷回忆", "不看答案，用自己的话写出核心机制。", "#06B6D4"),
        ("4", "迁移应用", "把方法放进一个新的真实问题中检验。", "#10B981"),
    ]
    cards_y = y + 34
    for index, (number, title, body, color) in enumerate(methods):
        row = index // 2
        col = index % 2
        x1 = M + col * 568
        y1 = cards_y + row * 148
        soft_card(
            image,
            (x1, y1, x1 + 540, y1 + 126),
            title,
            body,
            accent=color,
            number=number,
            title_size=23,
            body_size=17,
        )
    screen_frame(
        image,
        base.ASSETS["active"],
        (M, cards_y + 330, W - M, 1498),
        contain=True,
        label="至少完成一种：闭卷回忆、费曼解释或迁移应用",
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (M, 1530, W - M, 1606),
        radius=21,
        fill="#0B1635",
    )
    draw.text(
        (W // 2, 1568),
        "第一次体验到这里就已经成功；连接 Obsidian 是下一步，不是前置条件。",
        font=base.font(19, bold=True),
        fill="#FFFFFF",
        anchor="mm",
    )
    base.footer(image)
    return base.save_page(image, 4)


def page_5() -> Path:
    image = base.gradient_background("#FCFBFF", "#F1EDFF")
    header(image, 5, "连接 Obsidian")
    y = base.title_block(
        image,
        "确认有用以后，再连接你的知识库",
        "配对只需做一次。设备令牌保存在 Obsidian SecretStorage 中，网页不会显示或保存设备令牌。",
    )
    steps = [
        ("1", "网页生成六位码", f"打开 {PAIRING_URL}，生成 10 分钟配对码。"),
        ("2", "打开插件设置", "Obsidian → 设置 → 知洄 Vaultide 连接器。"),
        ("3", "填入地址和配对码", "确认服务地址是正式部署地址，输入六位码并点击 Pair。"),
    ]
    step_y = y + 36
    for index, (number, title, body) in enumerate(steps):
        soft_card(
            image,
            (M, step_y + index * 134, W - M, step_y + index * 134 + 112),
            title,
            body,
            accent="#7C3AED",
            number=number,
            title_size=23,
            body_size=17,
        )

    screen_frame(
        image,
        base.ASSETS["pairing_new"],
        (M, step_y + 430, W - M, 1460),
        contain=False,
        crop=(240, 40, 1040, 680),
        label="生成 10 分钟配对码，再填回 Obsidian 插件",
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (M, 1495, W - M, 1590),
        radius=22,
        fill="#E8FAF3",
    )
    draw.text(
        (M + 24, 1516),
        "已经配对成功？",
        font=base.font(20, bold=True),
        fill="#087C5B",
    )
    draw.text(
        (M + 190, 1518),
        "以后直接在 Obsidian 选择笔记或项目，不需要重复生成六位码。",
        font=base.font(19),
        fill=C["ink"],
    )
    base.footer(image)
    return base.save_page(image, 5)


def page_6() -> Path:
    image = base.gradient_background("#FCFBFF", "#F3EEFF")
    header(image, 6, "学习内部内容")
    y = base.title_block(
        image,
        "让一份笔记或整个项目重新进入课堂",
        "Obsidian 只负责本地选择与授权；网页仍然是主要看课、提问和练习的场景。",
    )
    command_box(image, y + 36, "当前笔记", CMD_NOTE)
    command_box(image, y + 158, "整个项目文件夹", CMD_FOLDER)
    draw = ImageDraw.Draw(image)
    steps_y = y + 296
    steps = [
        ("1", "选择范围", "确认本次授权的是当前笔记或目标项目。"),
        ("2", "检查预览", "检查文件范围、排除项和学习目标。"),
        ("3", "回到网页", "系统读取 SourceBundle 并生成课堂。"),
    ]
    for index, (number, title, body) in enumerate(steps):
        x1 = M + index * 372
        soft_card(
            image,
            (x1, steps_y, x1 + 350, steps_y + 178),
            title,
            body,
            accent="#7C3AED",
            number=number,
            title_size=21,
            body_size=16,
        )
    screen_frame(
        image,
        base.ASSETS["obsidian_guide_new"],
        (M, steps_y + 220, W - M, 1460),
        contain=True,
        label="单篇笔记和项目文件夹都能作为本轮学习材料",
    )
    draw.rounded_rectangle(
        (M, 1496, W - M, 1590),
        radius=22,
        fill="#EAF2FF",
    )
    draw.text(
        (M + 24, 1516),
        "边界",
        font=base.font(20, bold=True),
        fill="#2457B8",
    )
    draw.text(
        (M + 100, 1518),
        "原始笔记保持只读；学习进度、总结和复习计划写入独立伴随笔记。",
        font=base.font(19),
        fill=C["ink"],
    )
    base.footer(image)
    return base.save_page(image, 6)


def page_7() -> Path:
    image = base.gradient_background("#FBFCFF", "#F1F7FF")
    header(image, 7, "安全回写")
    y = base.title_block(
        image,
        "学习结果如何沉淀到 Obsidian",
        "回写采用双重确认：网页先预览和批准，Obsidian 再进行最终确认。",
    )
    steps = [
        ("1", "生成并预览", "网页检查内容、目标路径和将要写入的笔记类型。"),
        ("2", "网页批准", "确认后进入受控回写队列。"),
        ("3", "Obsidian 最终确认", "执行命令并核对目标路径，再应用写入。"),
    ]
    step_y = y + 36
    for index, (number, title, body) in enumerate(steps):
        x1 = M + index * 372
        soft_card(
            image,
            (x1, step_y, x1 + 350, step_y + 184),
            title,
            body,
            accent=["#2563EB", "#7C3AED", "#10B981"][index],
            number=number,
            title_size=21,
            body_size=16,
        )
    command_box(
        image,
        step_y + 220,
        "网页批准后，在 Obsidian 命令面板执行",
        CMD_WRITEBACK,
    )
    screen_frame(
        image,
        base.ASSETS["writeback_new"],
        (M, step_y + 360, W - M, 1465),
        contain=True,
        label="伴随笔记保存目标、来源、练习证据、进度和复习计划",
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (M, 1498, W - M, 1603),
        radius=22,
        fill="#FFF5D9",
    )
    draw.text(
        (M + 24, 1518),
        "两层笔记结构",
        font=base.font(20, bold=True),
        fill="#B65A00",
    )
    draw.text(
        (M + 198, 1519),
        "原有笔记 = 稳定来源；伴随笔记 = 可持续更新的学习层。",
        font=base.font(19, bold=True),
        fill=C["ink"],
    )
    base.footer(image)
    return base.save_page(image, 7)


def page_8() -> Path:
    image = base.gradient_background("#F8FAFF", "#F1EDFF")
    header(image, 8, "归纳与长期使用")
    y = base.title_block(
        image,
        "累积两三堂课后，再做知识归纳",
        "归纳不是把所有内容重写一遍，而是围绕一个具体问题汇总证据，并选择最合适的关系视角。",
    )
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (M, y + 28, W - M, y + 145),
        radius=24,
        fill="#E8FAFC",
        outline="#89DDE8",
        width=2,
    )
    draw.text(
        (M + 24, y + 50),
        "示例归纳问题",
        font=base.font(18, bold=True),
        fill="#087A83",
    )
    base.draw_paragraph(
        draw,
        (M + 24, y + 92),
        "最近一个月我在 Agent 记忆系统方面形成了哪些认识？不同方案之间有什么依赖、冲突和演化关系？",
        base.font(21, bold=True),
        C["ink"],
        W - 2 * M - 48,
        line_gap=4,
        max_lines=2,
    )
    lenses_y = y + 180
    lenses = [
        ("逻辑链", "下一步沿哪条路径继续"),
        ("主题岛", "哪些知识正在聚合"),
        ("来源流", "资料如何转化为理解"),
        ("时间演化", "认识如何形成和增强"),
    ]
    for index, (title, body) in enumerate(lenses):
        x1 = M + index * 278
        draw.rounded_rectangle(
            (x1, lenses_y, x1 + 260, lenses_y + 104),
            radius=22,
            fill="#FFFFFF",
            outline=C["line"],
            width=2,
        )
        draw.text(
            (x1 + 18, lenses_y + 20),
            title,
            font=base.font(21, bold=True),
            fill=["#7C3AED", "#06B6D4", "#F59E0B", "#2563EB"][index],
        )
        draw.text(
            (x1 + 18, lenses_y + 60),
            body,
            font=base.font(15),
            fill=C["muted"],
        )
    screen_frame(
        image,
        base.ASSETS["knowledge_space"],
        (M, lenses_y + 142, W - M, 1285),
        contain=True,
        label="关系图用于解释结论，不替代文字结论和证据",
    )

    loop_y = 1322
    draw.text(
        (M, loop_y),
        "长期使用节奏",
        font=base.font(26, bold=True),
        fill=C["ink"],
    )
    cadence = [
        ("每次", "一个真实问题"),
        ("课后", "一次主动验证"),
        ("每天", "一次安全沉淀"),
        ("每周", "一个归纳问题"),
    ]
    for index, (time, action) in enumerate(cadence):
        x1 = M + index * 278
        draw.rounded_rectangle(
            (x1, loop_y + 52, x1 + 260, loop_y + 152),
            radius=22,
            fill=["#F0E9FF", "#E8FAF3", "#FFF5D9", "#EAF2FF"][index],
        )
        draw.text(
            (x1 + 18, loop_y + 72),
            time,
            font=base.font(17, bold=True),
            fill=["#5B21B6", "#087C5B", "#B65A00", "#2457B8"][index],
        )
        draw.text(
            (x1 + 18, loop_y + 112),
            action,
            font=base.font(19, bold=True),
            fill=C["ink"],
        )

    draw.rounded_rectangle(
        (M, 1530, W - M, 1652),
        radius=24,
        fill="#0B1635",
    )
    qr = base.qr_image(96)
    qr_frame = Image.new("RGBA", (108, 108), "#FFFFFF")
    qr_frame.alpha_composite(qr, (6, 6))
    image.alpha_composite(qr_frame, (M + 12, 1537))
    draw.text(
        (M + 145, 1555),
        "现在开始第一堂课",
        font=base.font(26, bold=True),
        fill="#FFFFFF",
    )
    draw.text(
        (M + 145, 1604),
        URL,
        font=base.font(18, bold=True),
        fill="#BDF5FF",
    )
    base.footer(image)
    return base.save_page(image, 8)


def create_pdf(page_paths: list[Path]) -> Path:
    pdf_path = OUT / "知洄-Vaultide-2026.07-第一次使用手册.pdf"
    page_width, page_height = A4
    document = pdf_canvas.Canvas(
        str(pdf_path),
        pagesize=A4,
        pageCompression=1,
    )
    document.setTitle("知洄 Vaultide 2026.07 第一次使用手册")
    document.setAuthor("知洄 Vaultide")
    document.setSubject("首次用户快速上手：网页首课、Obsidian 配对、回写与归纳")
    for page_path in page_paths:
        document.drawImage(
            str(page_path),
            0,
            0,
            width=page_width,
            height=page_height,
            preserveAspectRatio=True,
            mask="auto",
        )
        document.showPage()
    document.save()
    return pdf_path


def create_contact_sheet(page_paths: list[Path]) -> Path:
    thumb_w = 300
    thumb_h = round(thumb_w * H / W)
    gap = 20
    cols = 4
    rows = 2
    sheet = Image.new(
        "RGB",
        (cols * thumb_w + (cols + 1) * gap, rows * thumb_h + (rows + 1) * gap),
        "#081127",
    )
    for index, page_path in enumerate(page_paths):
        page = Image.open(page_path).convert("RGB")
        page.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = gap + (index % cols) * (thumb_w + gap)
        y = gap + (index // cols) * (thumb_h + gap)
        sheet.paste(page, (x, y))
    path = OUT / "知洄-Vaultide-第一次使用手册页总览.png"
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
    ]
    page_paths = [builder() for builder in builders]
    pdf_path = create_pdf(page_paths)
    contact_sheet = create_contact_sheet(page_paths)
    shutil.copy2(pdf_path, PDF_OUT / pdf_path.name)

    manifest = {
        "product": "知洄 Vaultide",
        "release": RELEASE,
        "url": URL,
        "pairingUrl": PAIRING_URL,
        "audience": "第一次从宣传或广告接触产品的用户",
        "recommendedFirstRun": [
            "输入站点访问码",
            "不安装插件，先完成一堂外部学习课",
            "完成一次主动练习",
            "确认有用后再连接 Obsidian",
            "网页批准、Obsidian 最终确认回写",
            "累积两三堂课后进行问题驱动归纳",
        ],
        "exactCommands": [CMD_NOTE, CMD_FOLDER, CMD_WRITEBACK],
        "outputs": {
            "manualPdf": pdf_path.name,
            "manualContactSheet": contact_sheet.name,
            "cover": page_paths[0].relative_to(OUT).as_posix(),
            "pages": [path.relative_to(OUT).as_posix() for path in page_paths],
        },
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "README.md").write_text(
        "\n".join(
            [
                "# 知洄 Vaultide 第一次使用交付包",
                "",
                "这份手册面向第一次从宣传或广告接触产品的用户。",
                "",
                "推荐顺序：先完成网页首课，再连接 Obsidian，最后进行跨课堂归纳。",
                "",
                f"- 正式地址：{URL}",
                f"- Obsidian 配对页：{PAIRING_URL}",
                f"- 当前笔记命令：`{CMD_NOTE}`",
                f"- 项目文件夹命令：`{CMD_FOLDER}`",
                f"- 回写命令：`{CMD_WRITEBACK}`",
                "",
                "注意：当前为私人部署。站点访问码由产品所有者提供；六位码仅用于 Obsidian 设备配对。",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "pdf": str(pdf_path),
                "contactSheet": str(contact_sheet),
                "cover": str(page_paths[0]),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
