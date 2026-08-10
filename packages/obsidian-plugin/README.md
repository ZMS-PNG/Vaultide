# 知洄 Vaultide Learning Connector

知洄 Vaultide 的本地优先 Obsidian 连接器。它负责选择笔记、私有上传、
设备配对，以及对学习记录写回进行最后一次本地确认。

产品标语：**让每次学习，流回你的知识库。**

The manifest keeps the legacy plugin id `openmaic-learning` so existing installations,
settings, hotkeys, and SecretStorage credentials can upgrade without becoming a second plugin.

Current behavior:

- packages either the active Markdown note or an explicitly selected project folder;
- recursively discovers Markdown notes, lets the user deselect files, and previews the final
  item count and byte size before creating a project snapshot;
- keeps a local folder binding after a successful upload and labels notes as new, modified,
  or unchanged on the next project snapshot;
- preserves stable `sou_` source identities across retries and upgrades existing 0.4 bindings
  without requiring a data reset;
- registers the project before upload, sends current user-selected folders as `partial`
  coverage, and updates synchronized file state only after the server reports `validated`;
- excludes the managed Vaultide writeback root, hidden folders, and template folders from
  project imports to avoid feedback loops and accidental uploads;
- enforces the server limits of 50 notes, 8 MB source content, and a 10 MB archive locally;
- reads metadata and content locally, checks that the file did not change during packaging;
- validates and previews a `SourceBundle` without uploading it;
- reserves a pairing client that will exchange a one-time code for a scoped device token;
- stores device tokens only in Obsidian SecretStorage;
- fetches only commands addressed to this paired device and Vault;
- previews every writeback locally and requires confirmation;
- creates new Markdown notes only below the configured managed root;
- refuses overwrite, delete, arbitrary command execution, and paths outside the managed root;
- journals receipts locally before reporting them to Vaultide, so retries are safe.

Build with `pnpm --filter vaultide-learning-connector build`. Copy `main.js`,
`manifest.json`, and `styles.css` into the existing `openmaic-learning` plugin folder
for an in-place upgrade, or into a dedicated development Vault for manual testing.
