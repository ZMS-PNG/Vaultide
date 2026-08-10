$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$scriptDirectory = if ($PSScriptRoot) {
    $PSScriptRoot
}
else {
    Join-Path (Get-Location) "scripts"
}
$projectRoot = Split-Path -Parent $scriptDirectory
$voiceDir = Join-Path $projectRoot "product\vaultide-multispace-video\public\voice"
New-Item -ItemType Directory -Force -Path $voiceDir | Out-Null

$segments = @(
    @{
        Id = "01-hook"
        Text = "资料越来越多，真正学会的却越来越少。"
    },
    @{
        Id = "02-loop"
        Text = "知洄把一次提问，变成目标、证据、课堂、验证、沉淀、归纳和复习。"
    },
    @{
        Id = "03-external"
        Text = "学习外部新知识，它检索论文、科研、前沿技术、官方文档和 GitHub，保留权威来源，再生成互动课堂。"
    },
    @{
        Id = "04-internal"
        Text = "学习 Obsidian 内容，一份笔记，或整个项目文件夹，都能进入课堂。原笔记始终保持只读。"
    },
    @{
        Id = "05-active"
        Text = "闭卷回忆、费曼解释、迁移应用。看完只算进度，主动练习才形成掌握证据。"
    },
    @{
        Id = "06-deposit"
        Text = "网页先预览，Obsidian 最终确认。学习结果进入伴随笔记，不会静默覆盖知识库。"
    },
    @{
        Id = "07-synthesis"
        Text = "提出一个归纳问题，系统汇总课堂、来源和掌握证据，再用逻辑链、主题岛、来源流或时间演化，解释知识关系。"
    },
    @{
        Id = "08-cta"
        Text = "知洄 Vaultide。让每次学习，流回你的知识库。"
    }
)

$synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $voiceNames = $synth.GetInstalledVoices() | ForEach-Object {
        $_.VoiceInfo.Name
    }
    $preferred = $voiceNames | Where-Object {
        $_ -like "*Huihui*"
    } | Select-Object -First 1
    if (-not $preferred) {
        throw "Microsoft Huihui Chinese voice is not installed."
    }

    $synth.SelectVoice($preferred)
    $synth.Rate = 5
    $synth.Volume = 100

    foreach ($segment in $segments) {
        $path = Join-Path $voiceDir "$($segment.Id).wav"
        $synth.SetOutputToWaveFile($path)
        $synth.Speak($segment.Text)
        $synth.SetOutputToNull()
    }

    [ordered]@{
        voice = $preferred
        rate = $synth.Rate
        volume = $synth.Volume
        generatedAt = (Get-Date).ToString("o")
        segments = $segments
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $voiceDir "voiceover-manifest.json") -Encoding utf8
}
finally {
    $synth.Dispose()
}

Write-Output "Generated $($segments.Count) voiceover segments with $preferred."
