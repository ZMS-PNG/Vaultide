from __future__ import annotations

import hashlib
import json
import shutil
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASE_BASE = ROOT / "output" / "vaultide-multispace-2026.07"
PACKAGE_ROOT = RELEASE_BASE / "知洄-Vaultide-2026.07-多维知识空间版-产品发布包"
MARKETING_ROOT = PACKAGE_ROOT / "宣传资料"
PLUGIN_ROOT = PACKAGE_ROOT / "Obsidian-连接器"
DOCS_ROOT = PACKAGE_ROOT / "使用文档"
BRAND_ROOT = PACKAGE_ROOT / "品牌资产"
VIDEO_SOURCE_ROOT = PACKAGE_ROOT / "广告视频-可编辑源文件"
VIDEO_PROJECT = ROOT / "product" / "vaultide-multispace-video"


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


def write_package_readme():
    content = """# 知洄 Vaultide 2026.07 多维知识空间版

把散落知识变成可探索的学习空间。

## 包含内容

- `Obsidian-连接器/`：可直接复制到 Vault 插件目录的运行文件；
- `Vaultide-Obsidian-Connector-0.6.6.zip`：连接器独立安装包；
- `宣传资料/`：宣传海报、8 页使用手册、45 秒广告视频、旁白稿、二维码与镜头总览；
- `使用文档/`：快速开始、品牌说明、多维知识空间说明和发布说明；
- `品牌资产/`：知洄 Vaultide 标志、图标与主视觉；
- `广告视频-可编辑源文件/`：Remotion 项目源码，不包含 `node_modules`；
- `release.json`：发布元数据；
- `SHA256SUMS.txt`：包内文件完整性校验。

## 快速开始

1. 打开 `使用文档/QUICKSTART.md`。
2. 将 `Obsidian-连接器/` 中三个文件复制到：
   `<Vault>/.obsidian/plugins/openmaic-learning/`
3. 重新加载 Obsidian 并启用 `Vaultide Learning Connector`。
4. 打开正式网页：`https://openmaic-eight-eosin.vercel.app`
5. 按需完成设备配对，再选择外部知识、Obsidian 内容或知识归纳。

站点访问码由部署者在 Vercel 环境变量中配置，不写入发布包。

## 版权说明

知洄 Vaultide 基于 MIT 许可的 OpenMAIC 构建，并通过独立连接器与 Obsidian 协同。
它不是 OpenMAIC 或 Obsidian 的官方产品。请保留本包中的 `LICENSE`。
"""
    (PACKAGE_ROOT / "README.md").write_text(content, encoding="utf-8")


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

    poster = RELEASE_BASE / "知洄-Vaultide-2026.07-多维知识空间版-宣传海报.png"
    manual = (
        RELEASE_BASE
        / "知洄-Vaultide-2026.07-多维知识空间版-宣传使用手册.pdf"
    )
    video = VIDEO_PROJECT / "out" / "vaultide-multispace-ad-v2.mp4"
    contact_sheet = VIDEO_PROJECT / "out" / "video-contact-sheet-v2.png"
    keyframe = VIDEO_PROJECT / "out" / "frames" / "frame-space-v2.png"

    marketing_files = [
        (poster, "知洄-Vaultide-2026.07-多维知识空间版-宣传海报.png"),
        (manual, "知洄-Vaultide-2026.07-多维知识空间版-宣传使用手册.pdf"),
        (video, "知洄-Vaultide-2026.07-多维知识空间版-广告视频.mp4"),
        (
            VIDEO_PROJECT / "NARRATION.md",
            "知洄-Vaultide-2026.07-多维知识空间版-广告视频旁白稿.md",
        ),
        (
            RELEASE_BASE / "知洄-Vaultide-正式网页二维码.png",
            "知洄-Vaultide-正式网页二维码.png",
        ),
        (contact_sheet, "知洄-Vaultide-广告视频-镜头总览.png"),
        (keyframe, "知洄-Vaultide-广告视频-多维空间关键帧.png"),
        (RELEASE_BASE / "manual-contact-sheet.png", "知洄-Vaultide-手册页总览.png"),
        (RELEASE_BASE / "manifest.json", "宣传资料-manifest.json"),
    ]
    for source, name in marketing_files:
        copy_file(source, MARKETING_ROOT / name)

    docs = [
        (ROOT / "docs" / "vaultide" / "README.md", "README.md"),
        (ROOT / "docs" / "vaultide" / "QUICKSTART.md", "QUICKSTART.md"),
        (ROOT / "docs" / "vaultide" / "BRAND.md", "BRAND.md"),
        (
            ROOT / "docs" / "vaultide" / "MULTISPACE-RELEASE.md",
            "MULTISPACE-RELEASE.md",
        ),
        (
            ROOT
            / "docs"
            / "openmaic-obsidian"
            / "17-MULTIDIMENSIONAL-KNOWLEDGE-SPACE.md",
            "MULTIDIMENSIONAL-KNOWLEDGE-SPACE.md",
        ),
    ]
    for source, name in docs:
        copy_file(source, DOCS_ROOT / name)

    copy_file(
        ROOT / "product" / "vaultide-product.json",
        PACKAGE_ROOT / "vaultide-product.json",
    )
    copy_file(ROOT / "LICENSE", PACKAGE_ROOT / "LICENSE")

    for source in sorted((ROOT / "public" / "brand").glob("vaultide-*")):
        if source.is_file() and not source.name.endswith("-chroma.png"):
            copy_file(source, BRAND_ROOT / source.name)

    for name in [
        "package.json",
        "pnpm-lock.yaml",
        "remotion.config.ts",
        "tsconfig.json",
        "eslint.config.mjs",
        ".prettierrc",
        ".gitignore",
        "README.md",
        "NARRATION.md",
    ]:
        source = VIDEO_PROJECT / name
        if source.exists():
            copy_file(source, VIDEO_SOURCE_ROOT / name)
    shutil.copytree(
        VIDEO_PROJECT / "src",
        VIDEO_SOURCE_ROOT / "src",
        dirs_exist_ok=True,
    )
    shutil.copytree(
        VIDEO_PROJECT / "public",
        VIDEO_SOURCE_ROOT / "public",
        dirs_exist_ok=True,
    )

    product_manifest = json.loads(
        (ROOT / "product" / "vaultide-product.json").read_text(encoding="utf-8")
    )
    release_info = {
        "product": "知洄 Vaultide",
        "release": "2026.07 多维知识空间版",
        "releaseDate": "2026-07-24",
        "productVersion": product_manifest["product"]["version"],
        "connectorVersion": plugin_manifest["version"],
        "website": "https://openmaic-eight-eosin.vercel.app",
        "positioning": (
            "连接外部知识、网页课堂、Obsidian 与多维知识逻辑空间的"
            "个人智能学习系统"
        ),
        "deliverables": [
            "Obsidian 连接器安装包",
            "竖版宣传海报",
            "8 页宣传与使用手册",
            "45 秒 1080p 广告视频",
            "广告视频中文旁白稿",
            "广告视频镜头总览与关键帧",
            "品牌资产与广告视频可编辑源文件",
            "多维知识空间发布与技术说明",
        ],
        "video": {
            "durationSeconds": 45.056,
            "resolution": "1920x1080",
            "fps": 30,
            "videoCodec": "H.264",
            "audioCodec": "AAC",
        },
        "verifiedSnapshot": {
            "nodes": 112,
            "relationships": 193,
            "evidence": 14,
            "logicClusters": 6,
        },
        "attribution": (
            "基于 OpenMAIC 构建，并通过本地连接器与 Obsidian 协同。"
            "非 OpenMAIC 或 Obsidian 官方产品。"
        ),
    }
    (PACKAGE_ROOT / "release.json").write_text(
        json.dumps(release_info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_package_readme()

    hash_lines: list[str] = []
    for path in sorted(PACKAGE_ROOT.rglob("*")):
        if path.is_file() and path.name != "SHA256SUMS.txt":
            relative = path.relative_to(PACKAGE_ROOT).as_posix()
            hash_lines.append(f"{sha256(path)}  {relative}")
    (PACKAGE_ROOT / "SHA256SUMS.txt").write_text(
        "\n".join(hash_lines) + "\n",
        encoding="utf-8",
    )

    package_zip = (
        RELEASE_BASE
        / "知洄-Vaultide-2026.07-多维知识空间版-产品发布包.zip"
    )
    zip_directory(PACKAGE_ROOT, package_zip)

    result = {
        "packageDirectory": str(PACKAGE_ROOT),
        "packageZip": str(package_zip),
        "connectorZip": str(connector_zip),
        "connectorVersion": plugin_manifest["version"],
        "packageFiles": sum(1 for path in PACKAGE_ROOT.rglob("*") if path.is_file()),
        "packageZipSha256": sha256(package_zip),
    }
    (RELEASE_BASE / "package-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
