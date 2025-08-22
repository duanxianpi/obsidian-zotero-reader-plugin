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
	addIcon,
} from "obsidian";

import {
	ZoteroReaderView,
	VIEW_TYPE as READER_VIEW_TYPE,
} from "./view/zotero-reader-view";
import { initializeBlobUrls } from "./bundle-assets/inline-assets";

interface ZoteroReaderPluginSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: ZoteroReaderPluginSettings = {
	mySetting: "default",
};

const TOGGLE_ICON_CONTAINER_ID = "zotero-reader-toggle-container";
type ReaderIconDisplayRule = {
	key: string;
	optional: boolean;
	validator?: (value: any) => boolean;
	autoGenerate?: boolean;
};
const RULES: ReaderIconDisplayRule[] = [
	{
		key: "zotero-reader",
		optional: false,
		validator: (value) => value === true || value === "true",
	},
	{
		key: "source",
		optional: false,
		validator: (value) =>
			!(typeof value !== "string" || value.trim().length === 0),
	},
];

export default class ZoteroReaderPlugin extends Plugin {
	settings: ZoteroReaderPluginSettings;
	theme: string;
	BLOB_URL_MAP: Record<string, string>;

	async onload() {
		await this.loadSettings();

		// Initialize the inline blob URLs need by the reader
		(window as any).BLOB_URL_MAP = initializeBlobUrls();

		//
		addIcon(
			"zotero-icon",
			`
			<path
			style="fill:none;fill-opacity:1;stroke:currentColor;stroke-width:8.33331;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1"
			d="m 17.213858,8.3334232 h 65.067213 l 5.218851,9.8385298 -44.69689,56.088003 H 87.163227 V 91.666577 H 17.550592 L 12.500086,81.155337 56.607743,25.992326 H 17.045509 Z"/>
			`
		);

		addIcon(
			"zotero-loader-icon",
			`
			<defs>
			<path
				id="z"
				pathLength="1"
				d="m 17.213858,8.3334232 h 65.067213 l 5.218851,9.8385298 -44.69689,56.088003 H 87.163227 V 91.666577 H 17.550592 L 12.500086,81.155337 56.607743,25.992326 H 17.045509 Z"
			/>
			</defs>
			<!-- faint outline -->
			<use href="#z" class="loader-outline" />
			<use href="#z" class="loader-animation" />
			`
		);

		// Register the view
		this.registerView(READER_VIEW_TYPE, (leaf) => {
			const view = new ZoteroReaderView(leaf);
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
		Object.values((window as any).BLOB_URL_MAP).forEach((url) => {
			URL.revokeObjectURL(url as string);
		});
		console.log("Zotero Reader Plugin unloaded");
	}

	private getActiveFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(FileView);
		return view?.file ?? null;
	}

	// private async ensureNoteId(file: TFile): Promise<void> {
	// 	const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
	// 		| Record<string, unknown>
	// 		| undefined;

	// 	if (!fm || !fm["noteid"]) {
	// 		// Generate a new id
	// 		const newNoteId = uuidv4();

	// 		// Update the frontmatter
	// 		await this.app.fileManager.processFrontMatter(
	// 			file,
	// 			(frontmatter) => {
	// 				frontmatter["noteid"] = newNoteId;
	// 			}
	// 		);
	// 	}
	// }

	private satisfiesAllRules(file: TFile): boolean {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as
			| Record<string, unknown>
			| undefined;
		if (!fm) return false;
		return RULES.every((rule) => {
			const value = fm[rule.key];

			// Check if the field exists
			if (rule.optional) {
				return true;
			}

			// If there's a custom validator, use it
			if (rule.validator) {
				return rule.validator(value);
			}

			// Default: just check if the value exists and is not null
			return true;
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
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
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
		console.log("File satisfies all rules?", file);
		if (!this.satisfiesAllRules(file)) return;

		const btnContainer = document.createElement("div");
		btnContainer.id = TOGGLE_ICON_CONTAINER_ID;
		actionsEl.prepend(btnContainer);

		// Create a button and insert it into the actions area (next to "pencil/more")
		const btn = new ButtonComponent(btnContainer);
		btn.setIcon("zotero-icon");
		btn.setClass("clickable-icon");
		btn.setClass("view-action");
		btn.setTooltip("Open as Zotero Reader");
		btn.onClick(async () => {
			await activeView.leaf.setViewState({
				type: READER_VIEW_TYPE,
				state: {
					file: file,
					previousViewState: activeView.getState(),
					previousViewType: activeView.getViewType(),
				},
				active: true,
			});
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
