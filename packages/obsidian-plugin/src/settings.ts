import { Notice, PluginSettingTab, Setting, type App } from 'obsidian';
import type OpenMaicLearningPlugin from './main';
import { normalizeServerUrl } from './server-url';
import { normalizeManagedRoot } from './writeback-safety';

export class OpenMaicSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: OpenMaicLearningPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '知洄 Vaultide 连接器' });
    containerEl.createEl('p', {
      text: '使用一次性六位码完成设备配对；设备令牌只保存在 Obsidian SecretStorage，不会写入插件 data.json。',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('知洄服务地址')
      .setDesc('填写正式 HTTPS 地址；本地开发时也可以使用 localhost。')
      .addText((text) =>
        text
          .setPlaceholder('https://vaultide.example.com')
          .setValue(this.plugin.bridgeSettings.serverUrl)
          .onChange(async (value) => {
            this.plugin.bridgeSettings.serverUrl = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: '网页访问' });
    containerEl.createEl('p', {
      text: '访问码本身不会自动过期。保存后只进入 Obsidian SecretStorage，不写入插件 data.json、普通笔记或日志。网页验证成功后，此设备保持登录 90 天。',
      cls: 'setting-item-description',
    });
    const accessCodeState = this.plugin.siteAccessCodeState();
    const accessCodeStateDescription: Record<typeof accessCodeState, string> = {
      missing: '未保存。请粘贴当前访问码，或前往 Vercel 重新设置 ACCESS_CODE。',
      stored: '已安全保存，尚未向当前站点验证。',
      checking: '正在验证当前站点配置…',
      valid: '有效，可以直接取回、复制并打开网页。',
      invalid: '已保存的访问码与当前站点不一致，请更新或重新设置。',
      disabled: '当前站点未启用访问码，无需填写。',
      unreachable: '暂时无法连接站点；本地访问码仍安全保存在 SecretStorage。',
    };
    const accessCodeStatusSetting = new Setting(containerEl)
      .setName('访问码状态')
      .setDesc(accessCodeStateDescription[accessCodeState]);
    if (this.plugin.hasStoredSiteAccessCode()) {
      accessCodeStatusSetting
        .addButton((button) =>
          button.setButtonText('验证有效性').onClick(async () => {
            button.setDisabled(true);
            try {
              await this.plugin.verifyStoredSiteAccessCodeWithNotice();
            } finally {
              this.display();
            }
          }),
        )
        .addButton((button) =>
          button.setButtonText('取回并复制').onClick(async () => {
            try {
              await this.plugin.copyStoredSiteAccessCode();
              new Notice('网页访问码已从 SecretStorage 取回并复制。');
            } catch (error) {
              new Notice(error instanceof Error ? error.message : '无法取回网页访问码。');
            }
          }),
        )
        .addButton((button) =>
          button
            .setButtonText(accessCodeState === 'invalid' ? '重新设置访问码' : '复制并打开网页')
            .onClick(() => {
              if (accessCodeState === 'invalid') {
                this.plugin.openSiteAccessCodeRecovery();
              } else {
                void this.plugin.openWebsiteWithAccessCode();
              }
            }),
        );
    } else {
      accessCodeStatusSetting.addButton((button) =>
        button.setButtonText('重新设置访问码').onClick(() => {
          this.plugin.openSiteAccessCodeRecovery();
        }),
      );
    }
    let siteAccessCode = '';
    const siteAccessSetting = new Setting(containerEl)
      .setName(this.plugin.hasStoredSiteAccessCode() ? '更新网页访问码' : '保存网页访问码')
      .setDesc(
        this.plugin.hasStoredSiteAccessCode()
          ? '以后可直接复制访问码并打开网页，不需要再去项目文件夹寻找。'
          : '只需从原配置中复制一次；以后由 Obsidian 的系统密钥存储保管。',
      )
      .addText((text) => {
        text.inputEl.type = 'password';
        text
          .setPlaceholder(
            this.plugin.hasStoredSiteAccessCode() ? '输入新访问码可覆盖' : '粘贴当前访问码',
          )
          .onChange((value) => {
            siteAccessCode = value;
          });
      })
      .addButton((button) =>
        button
          .setCta()
          .setButtonText(this.plugin.hasStoredSiteAccessCode() ? '更新' : '保存')
          .onClick(() => {
            try {
              this.plugin.saveSiteAccessCode(siteAccessCode);
              new Notice('网页访问码已保存到 Obsidian SecretStorage。');
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : '无法保存网页访问码。');
            }
          }),
      );
    if (this.plugin.hasStoredSiteAccessCode()) {
      siteAccessSetting.addExtraButton((button) =>
        button
          .setIcon('trash-2')
          .setTooltip('从 Obsidian SecretStorage 删除访问码')
          .onClick(() => {
            this.plugin.clearSiteAccessCode();
            new Notice('已删除本地保存的网页访问码。');
            this.display();
          }),
      );
    }

    new Setting(containerEl)
      .setName('资料快照保留天数')
      .setDesc('私有上传的笔记快照会按照这里设置的天数自动过期。')
      .addSlider((slider) =>
        slider
          .setLimits(1, 90, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.bridgeSettings.retentionDays)
          .onChange(async (value) => {
            this.plugin.bridgeSettings.retentionDays = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('受控回写目录')
      .setDesc(
        '知洄只能在这个 Vault 相对目录中创建伴随笔记，或更新其哈希一致的受管区块；绝不会修改原有笔记或自由编辑区。',
      )
      .addText((text) =>
        text
          .setPlaceholder('Vaultide')
          .setValue(this.plugin.bridgeSettings.managedRoot)
          .onChange(async (value) => {
            try {
              this.plugin.bridgeSettings.managedRoot = normalizeManagedRoot(value);
              await this.plugin.saveSettings();
            } catch (error) {
              new Notice(
                error instanceof Error ? error.message : 'Invalid managed writeback root.',
              );
            }
          }),
      );

    let pairingCode = '';
    const pairingSetting = new Setting(containerEl)
      .setName(this.plugin.isPaired() ? '设备已配对' : '配对这台设备')
      .setDesc(
        this.plugin.isPaired()
          ? `设备凭据有效期至 ${this.plugin.bridgeSettings.tokenExpiresAt ?? '未知时间'}。`
          : '输入知洄网页显示的六位码；该配对码不会被保存。',
      );

    if (this.plugin.isPaired()) {
      pairingSetting.addButton((button) =>
        button
          .setWarning()
          .setButtonText('断开配对')
          .onClick(async () => {
            await this.plugin.disconnect();
            new Notice('知洄设备凭据已清除。');
            this.display();
          }),
      );
    } else {
      pairingSetting.addButton((button) =>
        button.setButtonText('打开配对网页').onClick(() => {
          try {
            const pairingUrl = `${normalizeServerUrl(this.plugin.bridgeSettings.serverUrl)}/learning-pairing`;
            window.open(pairingUrl, '_blank', 'noopener,noreferrer');
          } catch (error) {
            new Notice(error instanceof Error ? error.message : '知洄服务地址无效。');
          }
        }),
      );
      pairingSetting
        .addText((text) =>
          text.setPlaceholder('123456').onChange((value) => {
            pairingCode = value.trim();
          }),
        )
        .addButton((button) =>
          button
            .setCta()
            .setButtonText('配对')
            .onClick(async () => {
              button.setDisabled(true);
              try {
                await this.plugin.pair(pairingCode);
                new Notice('知洄设备配对成功。');
                this.display();
              } catch (error) {
                new Notice(error instanceof Error ? error.message : '设备配对失败。');
              } finally {
                button.setDisabled(false);
              }
            }),
        );
    }

    containerEl.createEl('h3', { text: '同步与自动沉淀' });
    containerEl.createEl('p', {
      text: '默认完全手动。开启后，知洄只会在后台更新“已经由你创建并确认过”的 Vaultide 伴随笔记受管区块；原有笔记、首次创建伴随笔记、自由编辑区、冲突内容和任何其他回写始终需要你人工确认。',
      cls: 'setting-item-description',
    });

    new Setting(containerEl)
      .setName('回写确认方式')
      .setDesc(
        '“批量确认”会先完整展示本次安全回写清单，再由你一次确认；仍逐条执行本地路径、哈希和受管区块校验。',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption('manual', '逐条确认')
          .addOption('batch', '批量确认')
          .setValue(this.plugin.bridgeSettings.writebackReviewMode)
          .setDisabled(this.plugin.bridgeSettings.managedAutomationEnabled)
          .onChange(async (value) => {
            if (value !== 'manual' && value !== 'batch') return;
            dropdown.setDisabled(true);
            try {
              await this.plugin.setWritebackReviewMode(value);
              new Notice(value === 'batch' ? '已启用批量确认。' : '已切换为逐条确认。');
              this.display();
            } catch (error) {
              new Notice(error instanceof Error ? error.message : '无法更新回写确认方式。');
              this.display();
            }
          }),
      );

    new Setting(containerEl)
      .setName('自动沉淀到已有伴随笔记')
      .setDesc(
        this.plugin.isPaired()
          ? '本地开关和服务器策略必须同时确认才会执行。关闭后立即停止本地后台更新。'
          : '请先完成设备配对，才能开启此项。',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.bridgeSettings.managedAutomationEnabled)
          .setDisabled(!this.plugin.isPaired())
          .onChange(async (enabled) => {
            toggle.setDisabled(true);
            try {
              await this.plugin.setManagedAutomationEnabled(enabled);
              new Notice(enabled ? '已开启受控自动沉淀。' : '已关闭受控自动沉淀。');
              this.display();
            } catch (error) {
              toggle.setValue(this.plugin.bridgeSettings.managedAutomationEnabled);
              new Notice(error instanceof Error ? error.message : '无法更新自动沉淀设置。');
            } finally {
              toggle.setDisabled(!this.plugin.isPaired());
            }
          }),
      );

    new Setting(containerEl)
      .setName('后台检查间隔')
      .setDesc('每隔多久检查一次已授权的伴随笔记更新；范围为 5–60 分钟。')
      .addSlider((slider) =>
        slider
          .setLimits(5, 60, 5)
          .setDynamicTooltip()
          .setValue(this.plugin.bridgeSettings.managedAutomationIntervalMinutes)
          .setDisabled(!this.plugin.bridgeSettings.managedAutomationEnabled)
          .onChange(async (minutes) => {
            await this.plugin.setManagedAutomationIntervalMinutes(minutes);
          }),
      );

    if (this.plugin.bridgeSettings.managedAutomationLastRunAt) {
      containerEl.createEl('p', {
        text: `最近自动检查：${this.plugin.bridgeSettings.managedAutomationLastRunAt}\n${this.plugin.bridgeSettings.managedAutomationLastMessage ?? ''}`,
        cls: 'setting-item-description',
      });
    }

    containerEl.createEl('h3', { text: '本地设备身份' });
    containerEl.createEl('pre', {
      text: `deviceId: ${this.plugin.bridgeSettings.deviceId}\nvaultBindingId: ${this.plugin.bridgeSettings.vaultBindingId}\nboundProjects: ${this.plugin.bridgeSettings.projectBindings.length}\npendingReceipts: ${this.plugin.bridgeSettings.pendingWritebackReceipts.length}\nreviewMode: ${this.plugin.bridgeSettings.writebackReviewMode}\nmanagedAutomation: ${this.plugin.bridgeSettings.managedAutomationEnabled ? 'enabled' : 'manual'}`,
    });
  }
}
