from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
SOURCE_SCRIPT = ROOT / "scripts" / "create_openmaic_manual.py"
OUT = ROOT / "output" / "vaultide-2026"
PAGES = OUT / "pages"
PROOF = OUT / "pdf-proof"
URL = "https://openmaic-eight-eosin.vercel.app"
RELEASE = "2026.07 学习闭环版"


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
base.PDF_OUT = ROOT / "output" / "pdf"
base.ASSETS["hero"] = ROOT / "public" / "brand" / "vaultide-knowledge-loop-hero-v2.png"
base.ASSETS["logo_light"] = ROOT / "public" / "brand" / "vaultide-logo-horizontal-light.png"
base.ASSETS["knowledge"] = (
    ROOT / "output" / "playwright" / "audit-large-project" / "02-knowledge-synthesis-3d.png"
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


def add_cover_logo(canvas: Image.Image, x: int, y: int, width: int):
    logo = Image.open(base.ASSETS["logo_light"]).convert("RGBA")
    ratio = width / logo.width
    logo = logo.resize((width, round(logo.height * ratio)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(logo, (x, y))


def page_1() -> Path:
    im = cover_crop(base.ASSETS["hero"], (base.W, base.H))
    im = ImageEnhance.Brightness(im).enhance(0.72)

    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    for y in range(base.H):
        alpha = round(218 - 100 * (y / base.H))
        od.line((0, y, base.W, y), fill=(5, 9, 30, alpha))
    od.rectangle((0, 0, base.W, 520), fill=(5, 9, 30, 105))
    od.rectangle((0, 1260, base.W, base.H), fill=(5, 9, 30, 155))
    overlay = overlay.filter(ImageFilter.GaussianBlur(1))
    im.alpha_composite(overlay)

    d = ImageDraw.Draw(im)
    add_cover_logo(im, base.M, 64, 380)
    base.pill(
        d,
        base.M,
        220,
        RELEASE,
        "#2A1F58",
        "#B9F3FF",
        base.font(20, bold=True),
        pad_x=20,
        h=50,
    )
    base.draw_paragraph(
        d,
        (base.M, 318),
        "让知识真正\n成为你的能力",
        base.font(72, bold=True),
        "white",
        920,
        line_gap=18,
    )
    base.draw_paragraph(
        d,
        (base.M, 540),
        "连接外部知识、互动课堂与 Obsidian，形成可追溯、可回写、可归纳的个人学习闭环。",
        base.font(29),
        "#D9E7FF",
        1040,
        line_gap=10,
    )

    badges = [
        ("权威资料检索", "#243A75", "#CFE1FF"),
        ("互动课堂学习", "#44236E", "#E8D8FF"),
        ("安全写回 Obsidian", "#164A57", "#C6F7FF"),
        ("三维知识关系", "#243A75", "#CFE1FF"),
    ]
    x = base.M
    for text, fill, color in badges:
        width = base.pill(
            d,
            x,
            1210,
            text,
            fill,
            color,
            base.font(19, bold=True),
            pad_x=17,
            h=48,
        )
        x += width + 12

    qr = base.qr_image(190)
    qr_frame = Image.new("RGBA", (218, 218), "white")
    qr_frame.alpha_composite(qr, (14, 14))
    im.alpha_composite(qr_frame, (base.W - base.M - 218, 1390))
    d.text(
        (base.M, 1395),
        "知洄 Vaultide",
        font=base.font(38, bold=True),
        fill="white",
    )
    d.text(
        (base.M, 1452),
        "个人智能学习操作系统",
        font=base.font(25),
        fill="#B9D2FF",
    )
    d.text(
        (base.M, 1510),
        "让每次学习，流回你的知识库",
        font=base.font(27, bold=True),
        fill="#B9F3FF",
    )
    d.text(
        (base.M, 1645),
        URL,
        font=base.font(19),
        fill="#D9E7FF",
    )
    d.text(
        (base.W - base.M - 109, 1628),
        "扫码开始学习",
        font=base.font(18, bold=True),
        fill="#B9F3FF",
        anchor="ma",
    )
    return base.save_page(im, 1)


def page_6() -> Path:
    im = base.gradient_background("#F7FBFF", "#ECF9FB")
    base.header(im, 6, "知识归纳与三维关系")
    y = base.title_block(
        im,
        "从学习记录，长成你的知识地图",
        "按时间、板块、来源和掌握度归纳；关系图只展示已沉淀、可追溯的知识。",
    )
    d = ImageDraw.Draw(im)
    dimensions = [
        ("X", "时间", "看见学习轨迹", base.COLORS["blue"], base.COLORS["blue_soft"]),
        ("Y", "知识板块", "发现跨主题连接", base.COLORS["cyan"], base.COLORS["cyan_soft"]),
        ("Z", "掌握度", "定位待强化区域", base.COLORS["violet"], base.COLORS["violet_soft"]),
    ]
    for index, (axis, title, body, color, soft) in enumerate(dimensions):
        x1 = base.M + index * 372
        base.rounded(d, (x1, y + 32, x1 + 350, y + 176), 22, soft)
        d.text((x1 + 22, y + 53), axis, font=base.font(40, bold=True), fill=color)
        d.text((x1 + 88, y + 56), title, font=base.font(24, bold=True), fill=base.COLORS["ink"])
        d.text((x1 + 22, y + 116), body, font=base.font(18), fill=base.COLORS["muted"])

    shot_top = y + 215
    shot_bottom = 1328
    base.shadow_card(im, (base.M, shot_top, base.W - base.M, shot_bottom), radius=28, shadow_alpha=25)
    base.rounded_image(
        im,
        base.ASSETS["knowledge"],
        (base.M + 24, shot_top + 24, base.W - base.M - 24, shot_bottom - 24),
        radius=20,
        contain=True,
    )

    steps = [
        ("1", "选择归纳范围", "按项目、时间或板块筛选"),
        ("2", "观察关系", "查看密集连接和薄弱区"),
        ("3", "沉淀归纳", "批准后写入专门归纳目录"),
    ]
    for index, (number, title, body) in enumerate(steps):
        x1 = base.M + index * 372
        base.step_card(
            im,
            (x1, 1360, x1 + 350, 1538),
            number,
            title,
            body,
            base.COLORS["cyan"],
            base.COLORS["cyan_soft"],
        )
    base.footer(im)
    return base.save_page(im, 6)


def create_pdf(page_paths: list[Path]) -> Path:
    images = [Image.open(path).convert("RGB") for path in page_paths]
    pdf_path = OUT / "知洄-Vaultide-2026-宣传使用手册.pdf"
    images[0].save(
        pdf_path,
        save_all=True,
        append_images=images[1:],
        resolution=150.0,
    )
    return pdf_path


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PAGES.mkdir(parents=True, exist_ok=True)
    PROOF.mkdir(parents=True, exist_ok=True)

    missing = [str(path) for path in base.ASSETS.values() if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing assets:\n" + "\n".join(missing))

    builders = [
        page_1,
        base.page_2,
        base.page_3,
        base.page_4,
        base.page_5,
        page_6,
        base.page_7,
        base.page_8,
    ]
    page_paths = [builder() for builder in builders]
    poster = OUT / "知洄-Vaultide-2026-宣传海报.png"
    shutil.copy2(page_paths[0], poster)
    pdf = create_pdf(page_paths)
    shutil.copy2(pdf, ROOT / "output" / "pdf" / pdf.name)
    base.qr_image(600).convert("RGB").save(OUT / "知洄-Vaultide-访问二维码.png", quality=100)

    manifest = {
        "product": "知洄 Vaultide",
        "release": RELEASE,
        "positioning": "连接外部知识、互动课堂与 Obsidian 的个人智能学习操作系统",
        "tagline": "让每次学习，流回你的知识库",
        "url": URL,
        "outputs": {
            "poster": poster.name,
            "manualPdf": pdf.name,
            "promoVideo": "知洄-Vaultide-2026-宣传视频.mp4",
            "voiceoverScript": "知洄-Vaultide-2026-宣传视频旁白稿.md",
            "pagePreviews": [path.relative_to(OUT).as_posix() for path in page_paths],
        },
        "claims": [
            "外部知识检索与互动课堂",
            "Obsidian 单笔记和项目文件夹学习",
            "学习进度与伴随笔记受控回写",
            "按时间、板块、来源和掌握度进行知识归纳",
            "三维知识关系图与大规模图谱降级",
        ],
        "provenance": {
            "brand": "知洄 Vaultide 独立品牌",
            "technicalBasis": "基于 OpenMAIC 构建，并通过本地连接器与 Obsidian 协同",
            "officialProduct": False,
            "heroArtwork": "AI-generated abstract artwork; no product UI was synthesized",
            "screenshots": "Local same-version browser verification screenshots",
        },
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (OUT / "README.md").write_text(
        "\n".join(
            [
                "# 知洄 Vaultide 2026.07 产品宣传包",
                "",
                "知洄 Vaultide 是连接外部知识、互动课堂与 Obsidian 的个人智能学习操作系统。",
                "",
                "## 使用建议",
                "",
                "- 竖版海报：用于社交媒体长图、产品介绍页和现场展示。",
                "- PDF 手册：用于安装说明、首次使用引导和完整能力介绍。",
                "- 宣传视频：16:9 字幕版，可直接播放；旁白稿可用于后续配音。",
                "",
                "## 来源声明",
                "",
                "基于 OpenMAIC 构建，并通过本地连接器与 Obsidian 协同。非 OpenMAIC 或 Obsidian 官方产品。",
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(json.dumps(manifest["outputs"], ensure_ascii=False))


if __name__ == "__main__":
    main()
