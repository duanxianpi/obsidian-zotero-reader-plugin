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
	Menu,
} from "obsidian";

import {
	ZoteroReaderView,
	VIEW_TYPE as READER_VIEW_TYPE,
} from "./view/zotero-reader-view";
import { AnnotationManager } from "./view/annotation-manager";
import { InitializeBlobUrls } from "./bundle-assets/inline-assets";
import { OzrpAnnoCommentExtension } from "./editor/ozrp-anno-comment-extension";
import { CustomReaderTheme } from "./types/zotero-reader";

export interface ZoteroReaderPluginSettings {
	readerThemes: CustomReaderTheme[];
	sidebarPosition: "start" | "end";
	annotationBlockTemplate: string;
	copyLinkToSelectionTemplate: string;
	copyLinkToAnnotationTemplate: string;
	defaultAnnotationCopyType: "annotation" | "block";
}

export const DEFAULT_SETTINGS: ZoteroReaderPluginSettings = {
	readerThemes: [],
	sidebarPosition: "start",
	defaultAnnotationCopyType: "block",
	annotationBlockTemplate: `%% OZRP-ANNO-BEGIN {{rawJson}} %%
> [!ozrp-{{ type }}-{{ color }}] [{{source}}, page {{pageLabel}}]({{link}})
> %% OZRP-ANNO-QUOTE-BEGIN %%
> > {{ quote }}
> %% OZRP-ANNO-QUOTE-END %%
> 
{%- if comment.trim() %}
> %% OZRP-ANNO-COMM-BEGIN %%
> {{ comment }}
> %% OZRP-ANNO-COMM-END %% ^{{ id }}
{%- else %}
> %% OZRP-ANNO-COMM-BEGIN %% %% OZRP-ANNO-COMM-END %% ^{{ id }}
{%- endif %}

%% OZRP-ANNO-END %%`,
	copyLinkToSelectionTemplate: `> {{selectedText}} [page, {{pageLabel}}]({{link}})`,
	copyLinkToAnnotationTemplate: `> {{annotationText}} [page, {{pageLabel}}]({{link}})`,
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
		(window as any).BLOB_URL_MAP = InitializeBlobUrls();

		// Ensure MathJax is loaded
		MarkdownRenderer.render(
			this.app,
			"$\\int$",
			document.createElement("div"),
			"",
			new Component()
		);

		// Register the annotation comment extension
		this.registerEditorExtension(OzrpAnnoCommentExtension());

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

		addIcon(
			"zotero-note",
			`<path style="scale: 5;" d="M9.375 17.625H17.625V2.375H2.375V10.625M9.375 17.625L2.375 10.625M9.375 17.625V10.625H2.375" stroke="currentColor" stroke-width="1.25" fill="transparent"/>`
		);
		addIcon(
			"zotero-text",
			`<path style="scale: 5;" fill-rule="evenodd" clip-rule="evenodd" d="M9 2H4V4H9V17H11V4H16V2H11H9Z" fill="currentColor"/>`
		);
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
			const view = new ZoteroReaderView(leaf, this);
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

		// Add command to update file's annotations to latest template
		this.addCommand({
			id: "update-file-annotations-template",
			name: "Update file's annotations to latest template",
			checkCallback: (checking: boolean) => {
				const activeFile = this.app.workspace.getActiveFile();
				if (activeFile && activeFile.extension === "md") {
					if (!checking) {
						this.updateFileAnnotationsToLatestTemplate(activeFile);
					}
					return true;
				}
				return false;
			},
		});

		// Add command to update all annotations in vault to latest template
		this.addCommand({
			id: "update-all-annotations-template",
			name: "Update ALL annotations in vault to latest template",
			callback: () => {
				this.updateAllAnnotationsToLatestTemplate();
			},
		});

		// Register context menu for PDF, EPUB, and HTML files
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile) {
					const extension = file.extension.toLowerCase();
					if (extension === 'pdf' || extension === 'epub' || extension === 'html') {
						menu.addItem((item) => {
							item
								.setTitle("Create Zotero Reader Note")
								.setIcon("zotero-icon")
								.onClick(async () => {
									await this.createZoteroReaderNote(file);
								});
						});
					}
				}
			})
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
					mdSourceFilePath: file.path,
					sourceViewState: activeView.getState(),
				},
				active: true,
			});
		});
	}

	/**
	 * Update all annotations in a file to use the latest template
	 */
	private async updateFileAnnotationsToLatestTemplate(
		file: TFile
	): Promise<void> {
		try {
			// Create annotation manager instance - it will read the file content internally
			const annotationManager = await AnnotationManager.create(
				this.app.vault,
				file,
				this.settings.annotationBlockTemplate
			);

			const annotations = annotationManager.annotationMap;

			if (annotations.size === 0) {
				new Notice("No annotations found in this file");
				return;
			}

			// Update each annotation with its current JSON data to regenerate with new template
			const updatedCount =
				await annotationManager.updateAllAnnotationsToLatestTemplate();

			if (updatedCount > 0) {
				new Notice(
					`Updated ${updatedCount} annotation${
						updatedCount > 1 ? "s" : ""
					} to latest template`
				);
			} else {
				new Notice("No annotations were updated");
			}
		} catch (error) {
			console.error(
				"Error updating annotations to latest template:",
				error
			);
			new Notice(
				"Failed to update annotations. Check console for details."
			);
		}
	}

	/**
	 * Update all annotations in the entire vault to use the latest template
	 */
	private async updateAllAnnotationsToLatestTemplate(): Promise<void> {
		try {
			const files = this.app.vault.getMarkdownFiles();
			let totalUpdated = 0;
			let filesProcessed = 0;
			let filesWithAnnotations = 0;

			new Notice("Scanning vault for annotations...", 2000);

			for (const file of files) {
				try {
					const content = await this.app.vault.read(file);

					// Quick check if file contains annotation markers before creating manager
					if (!content.includes("OZRP-ANNO-BEGIN")) {
						continue;
					}

					const annotationManager = await AnnotationManager.create(
						this.app.vault,
						file,
						this.settings.annotationBlockTemplate
					);

					const annotations = annotationManager.annotationMap;

					if (annotations.size === 0) {
						continue;
					}

					filesWithAnnotations++;
					let fileUpdatedCount = 0;

					const updatedCount =
						await annotationManager.updateAllAnnotationsToLatestTemplate();
					fileUpdatedCount++;
					totalUpdated += updatedCount;

					if (fileUpdatedCount > 0) {
						console.log(
							`Updated ${fileUpdatedCount} annotations in ${file.path}`
						);
					}

					filesProcessed++;
				} catch (error) {
					console.error(`Error processing file ${file.path}:`, error);
				}
			}

			if (totalUpdated > 0) {
				new Notice(
					`Updated ${totalUpdated} annotations across ${filesWithAnnotations} files`
				);
			} else {
				new Notice(
					"No annotations found in vault or all annotations were already up to date"
				);
			}
		} catch (error) {
			console.error(
				"Error updating all annotations to latest template:",
				error
			);
			new Notice(
				"Failed to update annotations. Check console for details."
			);
		}
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
	 * Create a new note with Zotero Reader frontmatter for the given file
	 */
	private async createZoteroReaderNote(file: TFile): Promise<void> {
		try {
			// Generate note name based on the source file name
			const baseName = file.basename;
			const noteName = `${baseName}.md`;
			
			// Check if a note with this name already exists
			let finalNoteName = noteName;
			let counter = 1;
			while (this.app.vault.getFileByPath(finalNoteName)) {
				finalNoteName = `${baseName} (${counter}).md`;
				counter++;
			}

			// Create the content with YAML frontmatter
			const content = `---
zotero-reader: true
source: ${file.path}
---
%% OZRP-ANNO-BLOCKS-BEGIN %%
%% OZRP-ANNO-BLOCKS-END %%
`;

			// Create the new note
			const newFile = await this.app.vault.create(finalNoteName, content);
			
			// Open the new note in the active workspace
			const leaf = this.app.workspace.getLeaf();
			await leaf.openFile(newFile);
			
			new Notice(`Created Zotero Reader note: ${finalNoteName}`);
		} catch (error) {
			console.error("Error creating Zotero Reader note:", error);
			new Notice("Failed to create Zotero Reader note. Check console for details.");
		}
	}

	/**
	 * Handle protocol calls for zotero-reader
	 */
	private async handleProtocolCall(
		params: ObsidianProtocolData
	): Promise<void> {
		try {
			const { file, navigation } = params;

			const navigationInfo = JSON.parse(navigation);

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
				if (navigationInfo) {
					(existingLeaf.view as ZoteroReaderView).readerNavigate(
						navigationInfo
					);
				}
				return;
			}

			// Create a new view
			await this.createZoteroReaderView(file, navigationInfo);
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
			if (view && view.getState().mdSourceFilePath === filePath) {
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
		navigationInfo: any = null
	): Promise<void> {
		// Create a new leaf (you can modify this to use existing leaf or create in specific location)
		const leaf = this.app.workspace.getLeaf(true);

		const readerOptions = { location: {} };
		if (navigationInfo) {
			readerOptions.location = navigationInfo;
		}

		await leaf.setViewState({
			type: READER_VIEW_TYPE,
			state: {
				mdSourceFilePath: filePath,
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

		containerEl.createEl("h2", { text: "Zotero Reader Plugin Settings" });

		new Setting(containerEl)
			.setName("Sidebar Position")
			.setDesc(
				"Set the default position of the sidebar in the reader view"
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("start", "Start")
					.addOption("end", "End")
					.setValue(this.plugin.settings.sidebarPosition)
					.onChange(async (value) => {
						this.plugin.settings.sidebarPosition = value as
							| "start"
							| "end";
						await this.plugin.saveSettings();
					})
			);

		const defaultAnnotationCopyTypeSetting = new Setting(containerEl)
			.setName("Default Annotation Copy Type")
			.setDesc(
				"Set the default copy type for annotations. This will affect drag-and-drop and ctrl/cmd-c copy actions."
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption("annotation", "Annotation")
					.addOption("block", "Block")
					.setValue(this.plugin.settings.defaultAnnotationCopyType)
					.onChange(async (value) => {
						this.plugin.settings.defaultAnnotationCopyType = value as
							| "annotation"
							| "block";
						await this.plugin.saveSettings();
					})
			);

		const annotationTemplateSetting = new Setting(containerEl)
			.setName("Annotation Block Template")
			.setDesc(
				"Customize the template used for annotation blocks. You can use Nunjucks templating. See the documentation for available variables."
			)
			.addTextArea((text) => {
				text.setPlaceholder("Enter your custom annotation template...")
					.setValue(this.plugin.settings.annotationBlockTemplate)
					.onChange(async (value) => {
						this.plugin.settings.annotationBlockTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.wrap = "off";
				text.inputEl.style.width = "100%";
				const lineHeight = parseFloat(
					getComputedStyle(text.inputEl).lineHeight
				);
				text.inputEl.style.height =
					text.inputEl.scrollHeight + lineHeight + "px";
				text.inputEl.style.fontFamily = "monospace";
				text.inputEl.style.resize = "vertical";
			})
			.addButton((button) => {
				button
					.setButtonText("Reset to Default")
					.setTooltip("Reset the annotation template to the default")
					.onClick(async () => {
						this.plugin.settings.annotationBlockTemplate =
							DEFAULT_SETTINGS.annotationBlockTemplate;
						await this.plugin.saveSettings();
						this.display(); // Refresh the settings display
					});
			});

		annotationTemplateSetting.settingEl.style.flexDirection = "column";
		annotationTemplateSetting.settingEl.style.alignItems = "flex-start";
		annotationTemplateSetting.controlEl.style.flexDirection = "column";
		annotationTemplateSetting.controlEl.style.width = "100%";
		annotationTemplateSetting.controlEl.style.alignItems = "flex-end";

		const copyLinkToSelectionTemplateSetting = new Setting(containerEl)
			.setName("Copy Link to Selection Template")
			.setDesc(
				"Customize the template used for the 'Copy Link to Selection' action. You can use Nunjucks templating. See the documentation for available variables."
			)
			.addTextArea((text) => {
				text.setPlaceholder("Enter your custom copy link template...")
					.setValue(this.plugin.settings.copyLinkToSelectionTemplate)
					.onChange(async (value) => {
						this.plugin.settings.copyLinkToSelectionTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.wrap = "off";
				text.inputEl.style.width = "100%";
				const lineHeight = parseFloat(
					getComputedStyle(text.inputEl).lineHeight
				);
				text.inputEl.style.height =
					text.inputEl.scrollHeight + lineHeight + "px";
				text.inputEl.style.fontFamily = "monospace";
				text.inputEl.style.resize = "vertical";
			})
			.addButton((button) => {
				button
					.setButtonText("Reset to Default")
					.setTooltip("Reset the copy link template to the default")
					.onClick(async () => {
						this.plugin.settings.copyLinkToSelectionTemplate =
							DEFAULT_SETTINGS.copyLinkToSelectionTemplate;
						await this.plugin.saveSettings();
						this.display(); // Refresh the settings display
					});
			});

		copyLinkToSelectionTemplateSetting.settingEl.style.flexDirection = "column";
		copyLinkToSelectionTemplateSetting.settingEl.style.alignItems = "flex-start";
		copyLinkToSelectionTemplateSetting.controlEl.style.flexDirection = "column";
		copyLinkToSelectionTemplateSetting.controlEl.style.width = "100%";
		copyLinkToSelectionTemplateSetting.controlEl.style.alignItems = "flex-end";

		const copyLinkToAnnotationTemplateSetting = new Setting(containerEl)
			.setName("Copy Link to Annotation Template")
			.setDesc(
				"Customize the template used for the 'Copy Link to Annotation' action. You can use Nunjucks templating. See the documentation for available variables."
			)
			.addTextArea((text) => {
				text.setPlaceholder("Enter your custom copy link template...")
					.setValue(this.plugin.settings.copyLinkToAnnotationTemplate)
					.onChange(async (value) => {
						this.plugin.settings.copyLinkToAnnotationTemplate = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.wrap = "off";
				text.inputEl.style.width = "100%";
				const lineHeight = parseFloat(
					getComputedStyle(text.inputEl).lineHeight
				);
				text.inputEl.style.height =
					text.inputEl.scrollHeight + lineHeight + "px";
				text.inputEl.style.fontFamily = "monospace";
				text.inputEl.style.resize = "vertical";
			})
			.addButton((button) => {
				button
					.setButtonText("Reset to Default")
					.setTooltip("Reset the copy link template to the default")
					.onClick(async () => {
						this.plugin.settings.copyLinkToAnnotationTemplate =
							DEFAULT_SETTINGS.copyLinkToAnnotationTemplate;
						await this.plugin.saveSettings();
						this.display(); // Refresh the settings display
					});
			});

		copyLinkToAnnotationTemplateSetting.settingEl.style.flexDirection = "column";
		copyLinkToAnnotationTemplateSetting.settingEl.style.alignItems = "flex-start";
		copyLinkToAnnotationTemplateSetting.controlEl.style.flexDirection = "column";
		copyLinkToAnnotationTemplateSetting.controlEl.style.width = "100%";
		copyLinkToAnnotationTemplateSetting.controlEl.style.alignItems = "flex-end";

	}
}
