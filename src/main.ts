import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
} from "obsidian";

import {
	ZoteroReaderView,
	VIEW_TYPE,
	SUPPORTED_EXTENSIONS,
} from "./view";
import { initializeBlobUrls } from "./bundle-reader/inline-reader-resources";

interface ZoteroReaderPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: ZoteroReaderPluginSettings = {
	mySetting: "default",
};



export default class ZoteroReaderPlugin extends Plugin {
	settings: ZoteroReaderPluginSettings;
	BLOB_URL_MAP: Record<string, string>;

	async onload() {
		await this.loadSettings();

		// Initialize the inline blob URLs need by the reader
		this.BLOB_URL_MAP = initializeBlobUrls();

		console.log(this.BLOB_URL_MAP);

		// Register the view
		this.registerView(VIEW_TYPE, (leaf) => {
			const view = new ZoteroReaderView(leaf, this.BLOB_URL_MAP);
			return view;
		});

		// unregister the PDF file extension to use our custom view
		// https://github.com/MeepTech/obsidian-custom-file-extensions-plugin/blob/b6f40d38ceb93437ad9db61a6f81d0b1fb1352f7/src/main.ts#L136C11-L146C12
		try {
			/**@ts-expect-error */
			this.app.viewRegistry.unregisterExtensions(SUPPORTED_EXTENSIONS);
		} catch {
			const message = `Could not unregister extension: '${SUPPORTED_EXTENSIONS}'`;
			new Notification("Error: Zotero Reader Plugin", {
				body: message,
			});

			console.error(message);
		}

		// Register the extensions for our custom view
		this.registerExtensions(SUPPORTED_EXTENSIONS, VIEW_TYPE);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		// Clean up all reader instances when plugin is unloaded
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);

		// Revoke all blob URLs created by the plugin
		Object.values(this.BLOB_URL_MAP).forEach((url) => {
			URL.revokeObjectURL(url);
		});
		console.log("Zotero Reader Plugin unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: ZoteroReaderPlugin;

	constructor(app: App, plugin: ZoteroReaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Setting #1")
			.setDesc("It's a secret")
			.addText((text) =>
				text
					.setPlaceholder("Enter your secret")
					.setValue(this.plugin.settings.mySetting)
					.onChange(async (value) => {
						this.plugin.settings.mySetting = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
