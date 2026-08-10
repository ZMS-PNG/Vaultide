from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
BRAND_DIR = ROOT / "public" / "brand"
MARK_PATH = BRAND_DIR / "vaultide-mark.png"

FONT_CN_BOLD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_EN_BOLD = "C:/Windows/Fonts/arialbd.ttf"
FONT_CN = "C:/Windows/Fonts/msyh.ttc"

INK = "#17213D"
MUTED = "#63708A"
VIOLET = "#6D28D9"
PALE = "#F1ECFF"


def fit_mark(size: int) -> Image.Image:
    mark = Image.open(MARK_PATH).convert("RGBA")
    alpha = mark.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        mark = mark.crop(bbox)
    mark.thumbnail((size, size), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return canvas


def horizontal_logo(*, light_text: bool = False) -> Image.Image:
    image = Image.new("RGBA", (1440, 360), (0, 0, 0, 0))
    image.alpha_composite(fit_mark(284), (34, 38))
    draw = ImageDraw.Draw(image)
    ink = "#FFFFFF" if light_text else INK
    muted = "#DDD6FE" if light_text else MUTED
    draw.text((350, 72), "知洄", font=ImageFont.truetype(FONT_CN_BOLD, 112), fill=ink)
    draw.text((674, 91), "VAULTIDE", font=ImageFont.truetype(FONT_EN_BOLD, 72), fill=ink)
    draw.rounded_rectangle((350, 216, 1270, 221), radius=2, fill=VIOLET)
    draw.text(
        (350, 242),
        "让每次学习，流回你的知识库",
        font=ImageFont.truetype(FONT_CN, 35),
        fill=muted,
    )
    return image


def app_icon() -> Image.Image:
    image = Image.new("RGBA", (512, 512), PALE)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((8, 8, 504, 504), radius=116, fill=PALE, outline="#DED3FF", width=8)
    image.alpha_composite(fit_mark(390), (61, 61))
    return image


def compact_logo(*, light_text: bool = False) -> Image.Image:
    image = Image.new("RGBA", (1120, 280), (0, 0, 0, 0))
    image.alpha_composite(fit_mark(236), (22, 22))
    draw = ImageDraw.Draw(image)
    ink = "#FFFFFF" if light_text else INK
    draw.text((282, 70), "知洄", font=ImageFont.truetype(FONT_CN_BOLD, 96), fill=ink)
    draw.text((590, 91), "VAULTIDE", font=ImageFont.truetype(FONT_EN_BOLD, 58), fill=ink)
    return image


def main() -> None:
    BRAND_DIR.mkdir(parents=True, exist_ok=True)
    horizontal_logo().save(BRAND_DIR / "vaultide-logo-horizontal.png")
    horizontal_logo(light_text=True).save(BRAND_DIR / "vaultide-logo-horizontal-light.png")
    compact_logo().save(BRAND_DIR / "vaultide-logo-compact.png")
    compact_logo(light_text=True).save(BRAND_DIR / "vaultide-logo-compact-light.png")
    app_icon().save(BRAND_DIR / "vaultide-app-icon.png")
    print(BRAND_DIR)


if __name__ == "__main__":
    main()
