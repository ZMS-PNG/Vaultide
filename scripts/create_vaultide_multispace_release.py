from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SCRIPT = ROOT / "scripts" / "create_openmaic_manual.py"
OUT = ROOT / "output" / "vaultide-multispace-2026.07"
PAGES = OUT / "pages"
PDF_PROOF = OUT / "pdf-proof"
PDF_OUT = ROOT / "output" / "pdf"
URL = "https://openmaic-eight-eosin.vercel.app"
RELEASE = "2026.07 多维知识空间版"
TAGLINE = "让每次学习，流回你的知识库"


def load_base():
    spec = importlib.util.spec_from_file_location("vaultide_manual_base", SOURCE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {SOURCE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_base()
base.OUT = OUT
base.PAGES = PAGES
base.PDF_OUT = PDF_OUT
base.ASSETS.update(
    {
        "hero": ROOT / "public" / "brand" / "vaultide-knowledge-loop-hero-v2.png",
        "logo_light": ROOT / "public" / "brand" / "vaultide-logo-horizontal-light.png",
        "knowledge_all": ROOT
        / ".playwright-cli"
        / "page-2026-07-24T16-58-02-145Z.png",
        "knowledge_focus": ROOT
        / ".playwright-cli"
        / "page-2026-07-24T17-07-36-098Z.png",
    }
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
    fill=(9, 19, 50, 218),
    outline=(103, 232, 249, 96),
):
    x1, y1, x2, y2 = box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        (x1, y1 + 14, x2, y2 + 14),
        radius=radius,
        fill=(35, 8, 92, 110),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(shadow)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=2)


def cover_page() -> Path:
    im = cover_crop(base.ASSETS["hero"], (base.W, base.H))
    im = ImageEnhance.Brightness(im).enhance(0.52)
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(base.H):
        alpha = round(225 - 50 * (y / base.H))
        od.line((0, y, base.W, y), fill=(3, 8, 28, alpha))
    od.ellipse((580, 270, 1350, 1110), fill=(92, 48, 220, 50))
    od.ellipse((-280, 830, 600, 1690), fill=(10, 197, 230, 38))
    overlay = overlay.filter(ImageFilter.GaussianBlur(70))
    im.alpha_composite(overlay)

    d = ImageDraw.Draw(im)
    add_logo(im, base.M, 56, 360, light=True)
    base.pill(
        d,
        base.M,
        184,
        RELEASE,
        "#28205A",
        "#C8F7FF",
        base.font(19, bold=True),
        pad_x=18,
        h=48,
    )
    base.draw_paragraph(
        d,
        (base.M, 276),
        "把散落知识\n变成可探索的学习空间",
        base.font(64, bold=True),
        "white",
        1050,
        line_gap=16,
    )
    base.draw_paragraph(
        d,
        (base.M, 482),
        "外部检索、互动课堂、Obsidian 双笔记沉淀\n与多维知识逻辑空间，组成可追溯的个人学习闭环。",
        base.font(26),
        "#DCE9FF",
        1080,
        line_gap=9,
    )

    lens_y = 617
    lenses = [
        ("　逻辑链", "#7C3AED"),
        ("　主题岛", "#06B6D4"),
        ("　来源流", "#F59E0B"),
        ("　时间演化", "#3B82F6"),
    ]
    x = base.M
    for label, color in lenses:
        width = base.pill(
            d,
            x,
            lens_y,
            label,
            "#111B3C",
            "#F7FBFF",
            base.font(19, bold=True),
            pad_x=18,
            h=48,
        )
        d.ellipse((x + 13, lens_y + 17, x + 27, lens_y + 31), fill=color)
        x += width + 12

    shot_box = (base.M, 710, base.W - base.M, 1246)
    glass_card(im, shot_box, radius=34)
    base.rounded_image_crop(
        im,
        base.ASSETS["knowledge_all"],
        (32, 208, 836, 720),
        (shot_box[0] + 22, shot_box[1] + 22, shot_box[2] - 22, shot_box[3] - 22),
        radius=24,
    )
    d.rounded_rectangle(
        (base.M + 26, 738, base.M + 375, 788),
        radius=25,
        fill=(7, 15, 40, 225),
    )
    d.text(
        (base.M + 44, 763),
        "真实知识簇 · 点击聚焦 · 证据可回查",
        font=base.font(17, bold=True),
        fill="#C8F7FF",
        anchor="lm",
    )

    benefits = [
        ("学新知识", "权威来源进入课堂"),
        ("学已有项目", "单篇笔记或整个文件夹"),
        ("做长期归纳", "空间聚合与受控回写"),
    ]
    card_y = 1288
    card_w = 350
    for index, (title, body) in enumerate(benefits):
        x1 = base.M + index * 372
        glass_card(
            im,
            (x1, card_y, x1 + card_w, card_y + 135),
            radius=22,
            fill=(7, 17, 45, 220),
            outline=(124, 58, 237, 85),
        )
        d.text(
            (x1 + 20, card_y + 25),
            title,
            font=base.font(22, bold=True),
            fill="white",
        )
        base.draw_paragraph(
            d,
            (x1 + 20, card_y + 69),
            body,
            base.font(17),
            "#BFD2F6",
            card_w - 40,
            line_gap=5,
        )

    qr = base.qr_image(178)
    qr_frame = Image.new("RGBA", (202, 202), "white")
    qr_frame.alpha_composite(qr, (12, 12))
    im.alpha_composite(qr_frame, (base.W - base.M - 202, 1470))
    d.text((base.M, 1490), "知洄 Vaultide", font=base.font(34, bold=True), fill="white")
    d.text(
        (base.M, 1542),
        TAGLINE,
        font=base.font(24, bold=True),
        fill="#BDF5FF",
    )
    d.text((base.M, 1608), URL, font=base.font(17), fill="#DCE9FF")
    d.text(
        (base.W - base.M - 101, 1690),
        "扫码进入网页课堂",
        font=base.font(17, bold=True),
        fill="#BDF5FF",
        anchor="ma",
    )
    return base.save_page(im, 1)


def page_2() -> Path:
    im = base.gradient_background("#F8FBFF", "#F2EEFF")
    base.header(im, 2, "产品全景")
    y = base.title_block(
        im,
        "一个产品，覆盖三类真实学习目标",
        "不是把 AI 塞进笔记，而是把来源、课堂、进度、证据和沉淀连接起来。",
    )
    d = ImageDraw.Draw(im)
    modes = [
        (
            "01",
            "外部新知识",
            "论文、科研、前沿技术、GitHub 项目与权威文章",
            base.COLORS["blue"],
            base.COLORS["blue_soft"],
        ),
        (
            "02",
            "Obsidian 已有内容",
            "笔记、论文、会议、文稿与大型项目文件夹",
            base.COLORS["violet"],
            base.COLORS["violet_soft"],
        ),
        (
            "03",
            "跨时间 / 跨板块归纳",
            "把多次课堂沉淀为长期可探索的知识结构",
            base.COLORS["cyan"],
            base.COLORS["cyan_soft"],
        ),
    ]
    cy = y + 38
    for n, title, body, color, soft in modes:
        base.step_card(im, (base.M, cy, base.W - base.M, cy + 146), n, title, body, color, soft)
        cy += 164

    flow_y = cy + 20
    base.shadow_card(im, (base.M, flow_y, base.W - base.M, 1538), radius=28, shadow_alpha=24)
    d.text(
        (base.M + 28, flow_y + 28),
        "学习闭环",
        font=base.font(29, bold=True),
        fill=base.COLORS["ink"],
    )
    stages = [
        ("来源", "检索 / 本地笔记", base.COLORS["blue"]),
        ("课堂", "讲解 / 提问 / 练习", base.COLORS["violet"]),
        ("沉淀", "伴随笔记 / 学习记录", base.COLORS["green"]),
        ("空间", "归纳 / 聚类 / 回查", base.COLORS["cyan"]),
    ]
    top = flow_y + 112
    for index, (title, body, color) in enumerate(stages):
        x1 = base.M + 44 + index * 263
        d.rounded_rectangle(
            (x1, top, x1 + 218, top + 188),
            radius=24,
            fill="#F8FAFF",
            outline="#DDE3F1",
            width=2,
        )
        d.ellipse((x1 + 79, top + 24, x1 + 139, top + 84), fill=color)
        d.text(
            (x1 + 109, top + 54),
            str(index + 1),
            font=base.font(21, bold=True),
            fill="white",
            anchor="mm",
        )
        d.text(
            (x1 + 109, top + 108),
            title,
            font=base.font(25, bold=True),
            fill=base.COLORS["ink"],
            anchor="ma",
        )
        d.text(
            (x1 + 109, top + 151),
            body,
            font=base.font(17),
            fill=base.COLORS["muted"],
            anchor="ma",
        )
        if index < len(stages) - 1:
            d.line((x1 + 220, top + 94, x1 + 256, top + 94), fill="#AAB7D4", width=4)
            d.polygon(
                [
                    (x1 + 252, top + 86),
                    (x1 + 264, top + 94),
                    (x1 + 252, top + 102),
                ],
                fill="#AAB7D4",
            )

    base.rounded_image(
        im,
        base.ASSETS["home"],
        (base.M + 26, top + 230, base.W - base.M - 26, 1508),
        radius=20,
        contain=True,
    )
    base.footer(im)
    return base.save_page(im, 2)


def page_3() -> Path:
    return base.page_3()


def page_4() -> Path:
    im = base.gradient_background("#FCFAFF", "#F3EEFF")
    base.header(im, 4, "Obsidian 内容学习")
    y = base.title_block(
        im,
        "一份笔记或一个项目文件夹，都能进入课堂",
        "原笔记保持只读；课堂结果写入独立伴随笔记与学习记录。",
    )
    d = ImageDraw.Draw(im)
    base.command_box(
        im,
        y + 34,
        "单篇笔记 · Obsidian 命令面板",
        "Preview active note as a SourceBundle",
        base.COLORS["violet"],
    )
    base.command_box(
        im,
        y + 168,
        "项目文件夹 · Obsidian 命令面板",
        "Preview a project folder as a SourceBundle",
        base.COLORS["blue"],
    )

    sy = y + 330
    steps = [
        ("1", "本地扫描", "先看到范围、排除项和文件数量"),
        ("2", "一次授权", "只上传你批准的 Markdown 内容"),
        ("3", "目标检索", "从大项目中选出与本次目标相关的证据"),
    ]
    for index, (number, title, body) in enumerate(steps):
        x1 = base.M + index * 372
        base.step_card(
            im,
            (x1, sy, x1 + 350, sy + 184),
            number,
            title,
            body,
            base.COLORS["violet"],
            base.COLORS["violet_soft"],
        )
    shot_top = sy + 220
    base.shadow_card(im, (base.M, shot_top, base.W - base.M, 1545), radius=26, shadow_alpha=22)
    base.rounded_image_crop(
        im,
        base.ASSETS["guide"],
        (220, 45, 1020, 650),
        (base.M + 26, shot_top + 26, base.W - base.M - 26, 1519),
        radius=20,
    )
    base.footer(im)
    return base.save_page(im, 4)


def page_5() -> Path:
    return base.page_5()


def lens_card(
    canvas: Image.Image,
    x: int,
    y: int,
    title: str,
    axes: str,
    question: str,
    color: str,
):
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle(
        (x, y, x + 540, y + 176),
        radius=24,
        fill="#FFFFFF",
        outline="#DDE3F1",
        width=2,
    )
    d.rounded_rectangle((x, y, x + 12, y + 176), radius=6, fill=color)
    d.text((x + 30, y + 23), title, font=base.font(25, bold=True), fill=base.COLORS["ink"])
    d.text((x + 30, y + 68), axes, font=base.font(17, bold=True), fill=color)
    base.draw_paragraph(
        d,
        (x + 30, y + 108),
        question,
        base.font(17),
        base.COLORS["muted"],
        474,
        line_gap=4,
        max_lines=2,
    )


def page_6() -> Path:
    im = base.gradient_background("#F7FBFF", "#EDF9FF")
    base.header(im, 6, "多维知识逻辑空间")
    y = base.title_block(
        im,
        "四种透镜，回答四类学习问题",
        "同一批知识事实，不同空间投影；切换透镜不会改写 Obsidian 原笔记。",
    )
    lens_card(
        im,
        base.M,
        y + 36,
        "逻辑链",
        "X 认知流程 · Y 知识板块 · Z 学习证据",
        "知识从来源到课堂、概念、应用和复习，走到了哪里？",
        "#7C3AED",
    )
    lens_card(
        im,
        628,
        y + 36,
        "主题岛",
        "X 主题位置 · Y 项目范围 · Z 掌握状态",
        "当前知识主要聚合成哪些主题，哪些仍然薄弱？",
        "#06B6D4",
    )
    lens_card(
        im,
        base.M,
        y + 230,
        "来源流",
        "X 知识转化 · Y 项目板块 · Z 证据强度",
        "外部资料与原笔记，是否真正转化成理解和沉淀？",
        "#F59E0B",
    )
    lens_card(
        im,
        628,
        y + 230,
        "时间演化",
        "X 时间切片 · Y 知识板块 · Z 掌握变化",
        "知识结构随时间发生了怎样的积累和迁移？",
        "#3B82F6",
    )
    shot_top = y + 445
    base.shadow_card(im, (base.M, shot_top, base.W - base.M, 1538), radius=28, shadow_alpha=25)
    base.rounded_image_crop(
        im,
        base.ASSETS["knowledge_all"],
        (30, 0, 840, 720),
        (base.M + 24, shot_top + 24, base.W - base.M - 24, 1514),
        radius=20,
    )
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(
        (base.M + 42, shot_top + 42, base.M + 405, shot_top + 94),
        radius=26,
        fill=(7, 15, 40, 228),
    )
    d.text(
        (base.M + 62, shot_top + 68),
        "离散知识簇 · 自动取景 · WebGL / Canvas",
        font=base.font(17, bold=True),
        fill="#C8F7FF",
        anchor="lm",
    )
    base.footer(im)
    return base.save_page(im, 6)


def page_7() -> Path:
    im = base.gradient_background("#F8FBFF", "#F2F6FF")
    base.header(im, 7, "聚焦与证据回查")
    y = base.title_block(
        im,
        "空间不是装饰，它必须把你带回证据",
        "点击一个知识簇，只看簇内节点、内部关系与关联证据，再继续打开课堂、来源或伴随笔记。",
    )
    d = ImageDraw.Draw(im)
    metrics = [
        ("112", "知识节点", "#7C3AED"),
        ("193", "真实关系", "#06B6D4"),
        ("14", "学习证据", "#F59E0B"),
        ("6", "逻辑知识簇", "#3B82F6"),
    ]
    for index, (value, label, color) in enumerate(metrics):
        x1 = base.M + index * 276
        d.rounded_rectangle(
            (x1, y + 36, x1 + 252, y + 154),
            radius=22,
            fill="#FFFFFF",
            outline="#DDE3F1",
            width=2,
        )
        d.text((x1 + 22, y + 55), value, font=base.font(38, bold=True), fill=color)
        d.text(
            (x1 + 22, y + 112),
            label,
            font=base.font(18, bold=True),
            fill=base.COLORS["muted"],
        )

    shot_top = y + 190
    base.shadow_card(im, (base.M, shot_top, base.W - base.M, 1250), radius=28, shadow_alpha=25)
    base.rounded_image_crop(
        im,
        base.ASSETS["knowledge_focus"],
        (30, 0, 840, 720),
        (base.M + 24, shot_top + 24, base.W - base.M - 24, 1226),
        radius=20,
    )
    d.rounded_rectangle(
        (base.M + 42, shot_top + 42, base.M + 434, shot_top + 94),
        radius=26,
        fill=(7, 15, 40, 228),
    )
    d.text(
        (base.M + 62, shot_top + 68),
        "聚焦“软件与人工智能 · 概念建构”",
        font=base.font(17, bold=True),
        fill="#FFD78A",
        anchor="lm",
    )

    outcomes = [
        ("75 个节点", "只保留当前知识簇"),
        ("68 条关系", "看清簇内逻辑连接"),
        ("9 条证据", "回到来源、课堂与笔记"),
    ]
    oy = 1282
    for index, (title, body) in enumerate(outcomes):
        x1 = base.M + index * 372
        base.step_card(
            im,
            (x1, oy, x1 + 350, oy + 210),
            str(index + 1),
            title,
            body,
            base.COLORS["cyan"],
            base.COLORS["cyan_soft"],
        )
    d.text(
        (base.M, 1528),
        "真实项目验收快照 · 2026-07-24",
        font=base.font(18),
        fill=base.COLORS["muted"],
    )
    base.footer(im)
    return base.save_page(im, 7)


def page_8() -> Path:
    im = base.gradient_background("#FBFCFF", "#F1EDFF")
    base.header(im, 8, "快速开始")
    y = base.title_block(
        im,
        "第一次使用：从一个真实问题开始",
        "网页负责学习；Obsidian 负责选择、确认与长期沉淀。",
    )
    d = ImageDraw.Draw(im)
    steps = [
        ("1", "打开正式网页", "输入站点访问码，确认模型与搜索服务已配置。"),
        ("2", "按需完成设备配对", "网页生成六位一次性码，在插件设置中输入。"),
        ("3", "选择学习入口", "外部新知识、Obsidian 笔记 / 项目、知识归纳。"),
        ("4", "完成课堂与主动练习", "围绕一个具体目标提问、复述并应用。"),
        ("5", "批准沉淀", "网页预览后，再由 Obsidian 最终确认回写。"),
        ("6", "定期进入多维空间", "切换透镜、聚焦知识簇并回查证据。"),
    ]
    sy = y + 30
    for index, (number, title, body) in enumerate(steps):
        base.step_card(
            im,
            (base.M, sy + index * 142, base.W - base.M, sy + index * 142 + 124),
            number,
            title,
            body,
            base.COLORS["violet"],
            base.COLORS["violet_soft"],
        )

    callout_y = sy + 6 * 142 + 12
    d.rounded_rectangle(
        (base.M, callout_y, base.W - base.M, 1575),
        radius=28,
        fill="#0B1533",
    )
    qr = base.qr_image(210)
    qr_frame = Image.new("RGBA", (230, 230), "white")
    qr_frame.alpha_composite(qr, (10, 10))
    im.alpha_composite(qr_frame, (base.M + 26, callout_y + 24))
    d.text(
        (base.M + 294, callout_y + 38),
        "开始你的第一轮学习闭环",
        font=base.font(29, bold=True),
        fill="white",
    )
    d.text(
        (base.M + 294, callout_y + 94),
        URL,
        font=base.font(20, bold=True),
        fill="#BDF5FF",
    )
    base.draw_paragraph(
        d,
        (base.M + 294, callout_y + 142),
        "原笔记只读 · 网页预览批准 · Obsidian 最终确认 · 证据可回查",
        base.font(18),
        "#DCE9FF",
        760,
        line_gap=6,
    )
    base.footer(im)
    return base.save_page(im, 8)


def create_pdf(page_paths: list[Path]) -> Path:
    images = [Image.open(path).convert("RGB") for path in page_paths]
    pdf_path = OUT / "知洄-Vaultide-2026.07-多维知识空间版-宣传使用手册.pdf"
    images[0].save(
        pdf_path,
        save_all=True,
        append_images=images[1:],
        resolution=150.0,
    )
    return pdf_path


def create_contact_sheet(page_paths: list[Path]) -> Path:
    thumb_w, thumb_h = 300, 424
    gap = 16
    canvas = Image.new(
        "RGB",
        (gap + 4 * (thumb_w + gap), gap + 2 * (thumb_h + gap)),
        "#0B1028",
    )
    for index, path in enumerate(page_paths):
        page = Image.open(path).convert("RGB")
        page.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = gap + (index % 4) * (thumb_w + gap)
        y = gap + (index // 4) * (thumb_h + gap)
        canvas.paste(page, (x, y))
    output = OUT / "manual-contact-sheet.png"
    canvas.save(output, quality=95)
    return output


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PAGES.mkdir(parents=True, exist_ok=True)
    PDF_PROOF.mkdir(parents=True, exist_ok=True)
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
    poster = OUT / "知洄-Vaultide-2026.07-多维知识空间版-宣传海报.png"
    shutil.copy2(page_paths[0], poster)
    manual_cover = OUT / "知洄-Vaultide-2026.07-多维知识空间版-手册封面.png"
    shutil.copy2(page_paths[0], manual_cover)
    pdf = create_pdf(page_paths)
    contact_sheet = create_contact_sheet(page_paths)
    shutil.copy2(pdf, PDF_OUT / pdf.name)
    base.qr_image(600).convert("RGB").save(
        OUT / "知洄-Vaultide-正式网页二维码.png",
        quality=100,
    )

    manifest = {
        "product": "知洄 Vaultide",
        "release": RELEASE,
        "tagline": TAGLINE,
        "positioning": "连接外部知识、网页课堂、Obsidian 与多维知识逻辑空间的个人智能学习系统",
        "url": URL,
        "visualDirection": "多维知识星域",
        "verifiedSnapshot": {
            "date": "2026-07-24",
            "nodes": 112,
            "relationships": 193,
            "evidence": 14,
            "logicClusters": 6,
        },
        "outputs": {
            "poster": poster.name,
            "manualCover": manual_cover.name,
            "manualPdf": pdf.name,
            "manualContactSheet": contact_sheet.name,
            "pages": [path.name for path in page_paths],
        },
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
