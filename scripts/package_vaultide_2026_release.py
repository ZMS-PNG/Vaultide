from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE_BASE = ROOT / "output" / "vaultide-2026"
PACKAGE_ROOT = RELEASE_BASE / "知洄-Vaultide-2026.07-产品发布包"
MARKETING_ROOT = PACKAGE_ROOT / "宣传资料"
PLUGIN_ROOT = PACKAGE_ROOT / "Obsidian-连接器"
DOCS_ROOT = PACKAGE_ROOT / "使用文档"
BRAND_ROOT = PACKAGE_ROOT / "品牌资产"
VIDEO_SOURCE_ROOT = PACKAGE_ROOT / "宣传视频-可编辑源文件"


def copy_file(source: Path, destination: Path):
    if not source.exists():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def zip_directory(source: Path, output: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source).as_posix())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    for folder in [
        PACKAGE_ROOT,
        MARKETING_ROOT,
        PLUGIN_ROOT,
        DOCS_ROOT,
        BRAND_ROOT,
        VIDEO_SOURCE_ROOT,
    ]:
        folder.mkdir(parents=True, exist_ok=True)

    plugin_source = ROOT / "packages" / "obsidian-plugin"
    plugin_manifest = json.loads(
        (plugin_source / "manifest.json").read_text(encoding="utf-8")
    )
    for name in ["main.js", "manifest.json", "styles.css"]:
        copy_file(plugin_source / name, PLUGIN_ROOT / name)

    connector_zip = (
        PACKAGE_ROOT
        / f"Vaultide-Obsidian-Connector-{plugin_manifest['version']}.zip"
    )
    zip_directory(PLUGIN_ROOT, connector_zip)

    marketing_files = [
        "知洄-Vaultide-2026-宣传海报.png",
        "知洄-Vaultide-2026-宣传使用手册.pdf",
        "知洄-Vaultide-2026-宣传视频.mp4",
        "知洄-Vaultide-2026-宣传视频旁白稿.md",
        "知洄-Vaultide-访问二维码.png",
        "video-contact-sheet.png",
        "manifest.json",
    ]
    for name in marketing_files:
        copy_file(RELEASE_BASE / name, MARKETING_ROOT / name)

    for name in ["README.md", "QUICKSTART.md", "BRAND.md"]:
        copy_file(ROOT / "docs" / "vaultide" / name, DOCS_ROOT / name)

    copy_file(RELEASE_BASE / "README.md", PACKAGE_ROOT / "README.md")
    copy_file(
        ROOT / "product" / "vaultide-product.json",
        PACKAGE_ROOT / "vaultide-product.json",
    )
    copy_file(ROOT / "LICENSE", PACKAGE_ROOT / "LICENSE")

    for source in sorted((ROOT / "public" / "brand").glob("vaultide-*")):
        if source.is_file() and not source.name.endswith("-chroma.png"):
            copy_file(source, BRAND_ROOT / source.name)

    video_source = ROOT / "product" / "vaultide-promo-video"
    for name in [
        "package.json",
        "remotion.config.ts",
        "tsconfig.json",
        "eslint.config.mjs",
        ".prettierrc",
        "README.md",
    ]:
        source = video_source / name
        if source.exists():
            copy_file(source, VIDEO_SOURCE_ROOT / name)
    shutil.copytree(
        video_source / "src",
        VIDEO_SOURCE_ROOT / "src",
        dirs_exist_ok=True,
    )
    shutil.copytree(
        video_source / "public",
        VIDEO_SOURCE_ROOT / "public",
        dirs_exist_ok=True,
    )

    product_manifest = json.loads(
        (ROOT / "product" / "vaultide-product.json").read_text(encoding="utf-8")
    )
    release_info = {
        "product": "知洄 Vaultide",
        "release": "2026.07 学习闭环版",
        "productVersion": product_manifest["product"]["version"],
        "connectorVersion": plugin_manifest["version"],
        "website": "https://openmaic-eight-eosin.vercel.app",
        "deliverables": [
            "Obsidian 连接器安装包",
            "竖版宣传海报",
            "8 页宣传与使用手册",
            "45 秒 1080p 宣传视频",
            "宣传视频中文旁白稿",
            "品牌资产与视频可编辑源文件",
        ],
        "attribution": (
            "基于 OpenMAIC 构建，并通过本地连接器与 Obsidian 协同。"
            "非 OpenMAIC 或 Obsidian 官方产品。"
        ),
    }
    (PACKAGE_ROOT / "release.json").write_text(
        json.dumps(release_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    hash_lines: list[str] = []
    for path in sorted(PACKAGE_ROOT.rglob("*")):
        if path.is_file() and path.name != "SHA256SUMS.txt":
            relative = path.relative_to(PACKAGE_ROOT).as_posix()
            hash_lines.append(f"{sha256(path)}  {relative}")
    (PACKAGE_ROOT / "SHA256SUMS.txt").write_text(
        "\n".join(hash_lines) + "\n",
        encoding="utf-8",
    )

    package_zip = RELEASE_BASE / "知洄-Vaultide-2026.07-产品发布包.zip"
    zip_directory(PACKAGE_ROOT, package_zip)

    print(
        json.dumps(
            {
                "packageDirectory": str(PACKAGE_ROOT),
                "packageZip": str(package_zip),
                "connectorZip": str(connector_zip),
                "connectorVersion": plugin_manifest["version"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
