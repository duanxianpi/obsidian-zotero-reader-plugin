import {
	App,
	ButtonComponent,
	Editor,
	FileView,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	setIcon,
	Setting,
	TFile,
	Vault,
	View,
	WorkspaceLeaf,
} from "obsidian";

import { ZoteroReaderView, VIEW_TYPE as READER_VIEW_TYPE } from "./reader-view";
import { initializeBlobUrls } from "./bundle-reader/inline-reader-resources";
import { v4 as uuidv4 } from "uuid";
import * as path from "path";

interface ZoteroReaderPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: ZoteroReaderPluginSettings = {
	mySetting: "default",
};

const SUPPORTED_EXTENSIONS = ["pdf", "epub", "html"];

const TOGGLE_ICON_CONTAINER_ID = "zotero-reader-toggle-container";
type ReaderIconDisplayRule = {
	key: string;
	optional: boolean;
	validator?: (value: any, vault: Vault) => boolean;
	autoGenerate?: boolean;
};
const RULES: ReaderIconDisplayRule[] = [
	{
		key: "zotero-reader",
		optional: false,
		validator: (value, _) => value === true || value === "true",
	},
	{
		key: "url",
		optional: false,
		validator: (value, vault) => {
			if (typeof value !== "string" || value.trim().length === 0) {
				return false;
			}

			const trimmedValue = value.trim();

			// Check if it's an HTTP(S) URL - no validation needed for URLs
			if (
				trimmedValue.startsWith("http://") ||
				trimmedValue.startsWith("https://")
			) {
				return true;
			}

			// Check if it's an Obsidian URI scheme path
			if (trimmedValue.startsWith("obsidian://")) {
				try {
					const url = new URL(trimmedValue);
					const fileParam = url.searchParams.get("file");

					if (!fileParam) {
						return false;
					}

					// Check if the file extension is supported
					const extname = path.extname(fileParam).slice(1);
					if (!SUPPORTED_EXTENSIONS.includes(extname)) {
						return false;
					}

					// Check if the file exists in the current vault
					if (vault) {
						const file = vault.getAbstractFileByPath(fileParam);
						if (!file || !(file instanceof TFile)) return false;
					}

					return true;
				} catch {
					return false;
				}
			}

			// For relative file paths, check if file exists in vault
			const file = vault.getAbstractFileByPath(trimmedValue);
			if (!file || !(file instanceof TFile)) return false;

			// Check if file extension is supported
			const extname = path.extname(trimmedValue).slice(1);
			return SUPPORTED_EXTENSIONS.includes(extname);
		},
	},
];

export default class ZoteroReaderPlugin extends Plugin {
	settings: ZoteroReaderPluginSettings;
	theme: string;
	BLOB_URL_MAP: Record<string, string>;

	async onload() {
		await this.loadSettings();

		// Initialize the inline blob URLs need by the reader
		this.BLOB_URL_MAP = initializeBlobUrls();

		// Register the view
		this.registerView(READER_VIEW_TYPE, (leaf) => {
			const view = new ZoteroReaderView(
				leaf,
				this.BLOB_URL_MAP
			);
			return view;
		});

		// Register the event for reader icon display
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => {
				this.initHeaderToggleButton();
			})
		);

		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				const active = this.getActiveFile();
				if (active && file.path === active.path)
					this.initHeaderToggleButton();
			})
		);

		this.initHeaderToggleButton();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {
		this.removeIconFrom(document.body);

		// Clean up all reader instances when plugin is unloaded
		this.app.workspace.detachLeavesOfType(READER_VIEW_TYPE);

		// Revoke all blob URLs created by the plugin
		Object.values(this.BLOB_URL_MAP).forEach((url) => {
			URL.revokeObjectURL(url);
		});
		console.log("Zotero Reader Plugin unloaded");
	}

	private getActiveFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(FileView);
		return view?.file ?? null;
	}

	private async ensureNoteId(file: TFile): Promise<void> {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
			| Record<string, unknown>
			| undefined;

		if (!fm || !fm["noteid"]) {
			// Generate a new UUID
			const newNoteId = uuidv4();

			// Update the frontmatter
			await this.app.fileManager.processFrontMatter(
				file,
				(frontmatter) => {
					frontmatter["noteid"] = newNoteId;
				}
			);
		}
	}

	private satisfiesAllRules(file: TFile): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
			| Record<string, unknown>
			| undefined;
		if (!fm) return false;
		console.log(fm);
		return RULES.every((rule) => {
			const value = fm[rule.key];

			// Check if the field exists
			if (rule.optional) {
				return true;
			}

			// If there's a custom validator, use it
			if (rule.validator) {
				return rule.validator(value, this.app.vault);
			}

			// Default: just check if the value exists and is not null
			return true;
		});
	}

	private async toggleReaderView(leaf: WorkspaceLeaf, file: TFile) {
		this.ensureNoteId(file);

		// Get frontmatter data
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
			| Record<string, unknown>
			| undefined;

		// Extract relevant information from frontmatter
		const url = fm?.["url"] as string;
		const noteId = fm?.["noteid"] as string;

		// Determine the source type and prepare state accordingly
		let sourceType: "local" | "url" | "obsidian-uri" = "local";
		let sourceUrl = "";

		if (typeof url === "string") {
			const trimmedUrl = url.trim();
			if (
				trimmedUrl.startsWith("http://") ||
				trimmedUrl.startsWith("https://")
			) {
				sourceType = "url";
				sourceUrl = trimmedUrl;
			} else if (trimmedUrl.startsWith("obsidian://")) {
				sourceType = "obsidian-uri";
				sourceUrl = trimmedUrl;
			} else {
				sourceType = "local";
				sourceUrl = trimmedUrl; // relative path
			}
		}

		// Store comprehensive state for the reader view
		await leaf.setViewState({
			type: READER_VIEW_TYPE,
			state: {
				mdFile: file,
				mdFrontmatter: fm,
				noteId: noteId,
				sourceType: sourceType,
				sourceUrl: sourceUrl,
			},
			active: true,
		});
	}

	private removeIconFrom(ele: HTMLElement) {
		const icons = ele.querySelectorAll(`#${TOGGLE_ICON_CONTAINER_ID}`);
		icons.forEach((icon) => {
			icon.remove();
		});
	}

	private initHeaderToggleButton() {
		// Check if active view is at least a FileView and satisfies all rules
		const activeView = this.app.workspace.getActiveViewOfType(FileView);
		if (!activeView || !activeView.file) return;

		const file = activeView.file;

		// Check if the view has an actions element
		const actionsEl = (activeView as any).actionsEl as
			| HTMLElement
			| undefined;

		if (!actionsEl) return;

		// Remove old icon
		this.removeIconFrom(actionsEl);

		// Check if the file satisfies all rules
		if (!this.satisfiesAllRules(file)) return;

		const btnContainer = document.createElement("div");
		btnContainer.id = TOGGLE_ICON_CONTAINER_ID;
		actionsEl.prepend(btnContainer);

		// Create a button and insert it into the actions area (next to "pencil/more")
		const btn = new ButtonComponent(btnContainer);
		btn.setIcon("monitor-play");
		btn.setClass("clickable-icon");
		btn.setClass("view-action");
		btn.setTooltip("Open as Zotero Reader");
		btn.onClick(async () => {
			await this.toggleReaderView(activeView.leaf, file);
		});
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
