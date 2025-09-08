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
	MarkdownRenderer,
	Component,
	ObsidianProtocolData,
} from "obsidian";

import {
	ZoteroReaderView,
	VIEW_TYPE as READER_VIEW_TYPE,
} from "./view/zotero-reader-view";
import { initializeBlobUrls } from "./bundle-assets/inline-assets";
import { ozrpAnnoCommentExtension } from "./editor/ozrpAnnoCommentExtension";

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

		// Ensure MathJax is loaded
		MarkdownRenderer.render(
			this.app,
			"$\\int$",
			document.createElement("div"),
			"",
			new Component()
		);

		// Register the annotation comment extension
		this.registerEditorExtension(ozrpAnnoCommentExtension());

		// Add custom icons
		addIcon(
			"zotero-underline",
			`
			<path style="scale: 5;" fill-rule="evenodd" clip-rule="evenodd" d="M16 16L11 4H9L4 16H6.16667L7.41667 13H12.5833L13.8333 16H16ZM10 6.8L8.04167 11.5H11.9583L10 6.8ZM2 17H3H17H18V17.25V18V18.25H17H3H2V18V17.25V17Z" fill="currentColor"/>
			`
		);

		addIcon(
			"zotero-highlight",
			`<path style="scale: 5;" fill-rule="evenodd" clip-rule="evenodd" d="M3 3H17V17H3V3ZM1.75 1.75H3H17H18.25V3V17V18.25H17H3H1.75V17V3V1.75ZM16 16L11 4H9L4 16H6.16667L7.41667 13H12.5833L13.8333 16H16ZM10 6.8L8.04167 11.5H11.9583L10 6.8Z" fill="currentColor"/>`
		);

		addIcon("zotero-note", `<path style="scale: 5;" d="M9.375 17.625H17.625V2.375H2.375V10.625M9.375 17.625L2.375 10.625M9.375 17.625V10.625H2.375" stroke="currentColor" stroke-width="1.25" fill="transparent"/>`);
		addIcon("zotero-text", `<path style="scale: 5;" fill-rule="evenodd" clip-rule="evenodd" d="M9 2H4V4H9V17H11V4H16V2H11H9Z" fill="currentColor"/>`);
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

		// Register protocol handler for zotero-reader URIs
		// Usage: obsidian://zotero-reader?filePath=path/to/file.md
		this.registerObsidianProtocolHandler(
			"zotero-reader",
			this.handleProtocolCall.bind(this)
		);

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
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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
					sourceFilePath: file.path,
					sourceViewState: activeView.getState(),
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

	/**
	 * Handle protocol calls for zotero-reader
	 */
	private async handleProtocolCall(
		params: ObsidianProtocolData
	): Promise<void> {
		try {
			const { file, annotation } = params;

			if (!file) {
				new Notice(
					"Missing filePath parameter in zotero-reader protocol call"
				);
				return;
			}

			// Check if the file exists
			const tfile = this.app.vault.getFileByPath(file);
			if (!tfile || !(tfile instanceof TFile)) {
				new Notice(`File not found: ${file}`);
				return;
			}

			// Check if a view with the same file path already exists
			const existingLeaf = this.findExistingZoteroReaderLeaf(file);
			if (existingLeaf) {
				// Focus the existing view
				this.app.workspace.setActiveLeaf(existingLeaf);
				if (annotation) {
					(
						existingLeaf.view as ZoteroReaderView
					).navigateToAnnotation(annotation);
				}
				return;
			}

			// Create a new view
			await this.createZoteroReaderView(file, annotation);
		} catch (error) {
			console.error("Error handling zotero-reader protocol call:", error);
			new Notice("Failed to open Zotero Reader view");
		}
	}

	/**
	 * Find an existing ZoteroReaderView leaf with the specified file path
	 */
	private findExistingZoteroReaderLeaf(
		filePath: string
	): WorkspaceLeaf | null {
		const leaves = this.app.workspace.getLeavesOfType(READER_VIEW_TYPE);

		for (const leaf of leaves) {
			const view = leaf.view as ZoteroReaderView;
			if (view && view.getState().sourceFilePath === filePath) {
				return leaf;
			}
		}

		return null;
	}

	/**
	 * Create a new ZoteroReaderView with the specified file path and state
	 */
	private async createZoteroReaderView(
		filePath: string,
		annotation: string
	): Promise<void> {
		// Create a new leaf (you can modify this to use existing leaf or create in specific location)
		const leaf = this.app.workspace.getLeaf(true);

		const readerOptions = { location: {} };
		if (annotation) {
			readerOptions.location = { annotationID: annotation };
		}

		await leaf.setViewState({
			type: READER_VIEW_TYPE,
			state: {
				sourceFilePath: filePath,
				sourceViewState: {
					file: filePath,
				},
				readerOptions,
			},
			active: true,
		});
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
