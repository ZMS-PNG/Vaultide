from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "vaultide-first-use-2026.07"
PACKAGE = OUT / "知洄-Vaultide-2026.07-第一次使用交付包"
ZIP_BASE = OUT / "知洄-Vaultide-2026.07-第一次使用交付包"

PDF = OUT / "知洄-Vaultide-2026.07-第一次使用手册.pdf"
VIDEO = OUT / "知洄-Vaultide-2026.07-第一次使用真人配音视频-发布版.mp4"
MANUAL_OVERVIEW = OUT / "知洄-Vaultide-第一次使用手册页总览.png"
VIDEO_OVERVIEW = OUT / "知洄-Vaultide-第一次使用视频镜头总览.png"
CAPTIONS = (
    ROOT
    / "product"
    / "vaultide-multispace-video"
    / "src"
    / "captions.json"
)
VIDEO_SOURCE = (
    ROOT
    / "product"
    / "vaultide-multispace-video"
    / "src"
    / "FirstUseComposition.tsx"
)

URL = "https://openmaic-eight-eosin.vercel.app"
PAIRING_URL = f"{URL}/learning-pairing"
CMD_NOTE = "Preview active note as a SourceBundle"
CMD_FOLDER = "Preview a project folder as a SourceBundle"
CMD_WRITEBACK = "Check and apply Vaultide writebacks"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    required = [PDF, VIDEO, MANUAL_OVERVIEW, VIDEO_OVERVIEW, CAPTIONS, VIDEO_SOURCE]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing release artifacts:\n" + "\n".join(missing))

    docs = PACKAGE / "使用文档"
    media = PACKAGE / "宣传资料"
    editable = PACKAGE / "广告视频-可编辑源文件"
    docs.mkdir(parents=True, exist_ok=True)
    media.mkdir(parents=True, exist_ok=True)
    editable.mkdir(parents=True, exist_ok=True)

    shutil.copy2(PDF, docs / PDF.name)
    shutil.copy2(VIDEO, media / VIDEO.name)
    shutil.copy2(MANUAL_OVERVIEW, media / MANUAL_OVERVIEW.name)
    shutil.copy2(VIDEO_OVERVIEW, media / VIDEO_OVERVIEW.name)
    shutil.copy2(CAPTIONS, editable / "真人旁白字幕时间轴.json")
    shutil.copy2(VIDEO_SOURCE, editable / VIDEO_SOURCE.name)

    quickstart = "\n".join(
        [
            "# 知洄 Vaultide｜第一次使用",
            "",
            "## 推荐顺序",
            "",
            "1. 打开正式网页并输入站点访问码。",
            "2. 第一次不要先安装插件，先完成一堂“学习外部新知识”网页课。",
            "3. 在课堂中至少完成一次闭卷回忆、费曼解释或迁移应用。",
            "4. 确认产品有用后，再打开配对页生成六位码连接 Obsidian。",
            "5. 从 Obsidian 选择当前笔记或项目文件夹，回到网页学习。",
            "6. 网页批准回写，再在 Obsidian 最终确认。",
            "7. 累积两三堂课后，围绕一个具体问题进行知识归纳。",
            "",
            "## 两种访问码",
            "",
            "- 站点访问码：进入网页，由产品所有者提供。",
            "- 六位配对码：只用于连接 Obsidian，10 分钟有效且只能使用一次。",
            "",
            "## 地址",
            "",
            f"- 正式网页：{URL}",
            f"- Obsidian 配对：{PAIRING_URL}",
            "",
            "## Obsidian 命令",
            "",
            f"- 当前笔记：`{CMD_NOTE}`",
            f"- 项目文件夹：`{CMD_FOLDER}`",
            f"- 应用回写：`{CMD_WRITEBACK}`",
            "",
            "## 产品边界",
            "",
            "- 原始笔记保持只读。",
            "- 学习目标、进度、总结、证据和复习计划进入独立伴随笔记。",
            "- 回写采用“网页批准 + Obsidian 最终确认”。",
            "- 关系图用于解释归纳结论，不替代文字结论和证据。",
            "",
        ]
    )
    (docs / "QUICKSTART.md").write_text(quickstart, encoding="utf-8")

    video_notes = "\n".join(
        [
            "# 第一次使用真人配音视频说明",
            "",
            "- 时长：51.9 秒",
            "- 画幅：1920 x 1080",
            "- 帧率：30 fps",
            "- 视频编码：H.264",
            "- 音频编码：AAC，48 kHz，双声道",
            "- 最终综合响度：约 -15.9 LUFS",
            "- 配音：用户提供的真人中文录音",
            "- 字幕：逐句烧录中文字幕",
            "- 节奏：先网页首课，再连接 Obsidian，最后归纳复习",
            "",
            "隐私说明：原始 M4A 录音没有复制进对外交付包。",
            "",
        ]
    )
    (docs / "视频说明.md").write_text(video_notes, encoding="utf-8")

    manifest = {
        "product": "知洄 Vaultide",
        "release": "2026.07 第一次使用版",
        "url": URL,
        "pairingUrl": PAIRING_URL,
        "manual": {
            "file": f"使用文档/{PDF.name}",
            "pages": 8,
            "format": "A4 PDF",
        },
        "video": {
            "file": f"宣传资料/{VIDEO.name}",
            "durationSeconds": 51.9,
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "videoCodec": "H.264",
            "audioCodec": "AAC",
            "audioSampleRate": 48000,
            "channels": 2,
            "integratedLoudnessLufs": -15.94,
            "voice": "用户提供的真人中文录音",
        },
        "exactCommands": [CMD_NOTE, CMD_FOLDER, CMD_WRITEBACK],
        "disclosures": [
            "当前为私人部署，站点访问码由产品所有者提供。",
            "六位码只用于 Obsidian 设备配对。",
            "原始录音不包含在对外交付包中。",
        ],
    }
    (PACKAGE / "release.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    packaged_files = sorted(
        [path for path in PACKAGE.rglob("*") if path.is_file()],
        key=lambda path: path.as_posix(),
    )
    checksum_lines = [
        f"{sha256(path)}  {path.relative_to(PACKAGE).as_posix()}"
        for path in packaged_files
    ]
    (PACKAGE / "SHA256SUMS.txt").write_text(
        "\n".join(checksum_lines) + "\n",
        encoding="utf-8",
    )

    archive = Path(shutil.make_archive(str(ZIP_BASE), "zip", PACKAGE))
    result = {
        "package": str(PACKAGE),
        "archive": str(archive),
        "manual": str(docs / PDF.name),
        "video": str(media / VIDEO.name),
        "manualOverview": str(media / MANUAL_OVERVIEW.name),
        "videoOverview": str(media / VIDEO_OVERVIEW.name),
    }
    (OUT / "package-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
