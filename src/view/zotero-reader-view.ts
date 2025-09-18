import {
	WorkspaceLeaf,
	TFile,
	ViewStateResult,
	ItemView,
	getIcon,
	ButtonComponent,
	getFrontMatterInfo,
	parseYaml,
} from "obsidian";
import { IframeReaderBridge } from "./zotero-reader-bridge";
import {
	CreateReaderOptions,
	ColorScheme,
	ZoteroAnnotation,
} from "../types/zotero-reader";
import { AnnotationManager } from "./annotation-manager";
import ZoteroReaderPlugin from "src/main";

export const VIEW_TYPE = "zotero-reader-view";

interface ReaderViewState extends Record<string, unknown> {
	mdSourceFilePath: string;
	sourceViewState: Record<string, unknown>;
	readerOptions: Partial<CreateReaderOptions>;
}

export class ZoteroReaderView extends ItemView {
	private TOGGLE_MARKDOWN_CONTAINER_ID = "toggle-markdown-icon";

	private file: TFile | null;
	private fileFrontmatter?: Record<string, unknown>;

	private bridge?: IframeReaderBridge;
	private colorSchemeObserver?: MutationObserver;
	private annotationManager?: AnnotationManager;
	private colorScheme: ColorScheme;
	private plugin: ZoteroReaderPlugin;

	// State properties
	private state: ReaderViewState;

	constructor(leaf: WorkspaceLeaf, plugin: ZoteroReaderPlugin) {
		super(leaf);
		this.colorScheme =
			(getComputedStyle(document.body).colorScheme as ColorScheme) ??
			"dark";
		this.icon = "zotero-icon";
		this.plugin = plugin;
	}

	async setState(
		state: ReaderViewState,
		result: ViewStateResult
	): Promise<void> {
		// Update internal state
		this.state = { ...this.state, ...state };
		await super.setState(state, result);

		this.file = this.app.vault.getFileByPath(this.state.mdSourceFilePath);
		if (!this.file || !(this.file instanceof TFile)) {
			return;
		}

		// Get file content
		const content = await this.app.vault.read(this.file);

		this.fileFrontmatter = this.app.metadataCache.getFileCache(this.file)
			?.frontmatter as Record<string, unknown> | undefined;

		if (!this.fileFrontmatter) {
			// find the frontmatter block at the top of the file
			const info = getFrontMatterInfo(content);

			if (!info || !info.frontmatter) return;

			// turn the YAML string into a JS object
			this.fileFrontmatter = parseYaml(info.frontmatter) as Record<
				string,
				unknown
			>;
		}

		// Initialize annotation manager
		this.annotationManager = await AnnotationManager.create(
			this.app.vault,
			this.file,
			this.plugin.settings.annotationBlockTemplate
		);

		// Reload view
		this.renderReader();
	}

	getState(): ReaderViewState {
		return this.state;
	}

	readerNavigate(navigationInfo: any) {
		if (!this.bridge) return;

		this.bridge.navigate(navigationInfo);
	}

	private async renderReader() {
		if (
			!this.state ||
			!this.state.mdSourceFilePath ||
			!this.state.sourceViewState ||
			!this.file ||
			!this.fileFrontmatter
		) {
			return;
		}

		this.containerEl.children[0]
			.querySelector(".view-header-title")
			?.setText(this.getDisplayText());

		const loader = createDiv({
			cls: "loader-container",
		});
		loader.appendChild(getIcon("zotero-loader-icon")!);
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.appendChild(loader);

		try {
			// Create bridge once
			if (!this.bridge) {
				container.style.overflow = "hidden";
				container.style.padding = "unset";

				this.bridge = new IframeReaderBridge(
					container,
					this.state.mdSourceFilePath,
					this.plugin.settings
				);

				// Register event listeners
				this.bridge.onEventType("error", (evt) => {
					console.error(`${evt.code}: ${evt.message}`);
				});

				this.bridge.onEventType("sidebarToggled", (evt) => {
					this.handleSidebarToggled(evt.open);
				});

				this.bridge.onEventType("sidebarWidthChanged", (evt) => {
					this.handleSidebarWidthChanged(evt.width);
				});

				this.bridge.onEventType("openLink", (evt) => {
					console.log("Opening link:", evt.url);
				});

				this.bridge.onEventType("annotationsSaved", (evt) => {
					console.log("Annotations saved:", evt.annotations);
					this.handleAnnotationsSaved(evt.annotations);
				});

				this.bridge.onEventType("annotationsDeleted", (evt) => {
					console.log("Annotations deleted:", evt.ids);
					this.handleAnnotationsDeleted(evt.ids);
				});

				this.bridge.onEventType("viewStateChanged", (evt) => {
					this.handleViewStateChanged(evt.state, evt.primary);
					console.log("View state changed:", evt.primary, evt.state);
				});

				this.bridge.onEventType("saveCustomThemes", (evt) => {
					console.log("Custom themes saved:", evt.customThemes);
					this.handleCustomThemesSaved(evt.customThemes);
				});

				this.bridge.onEventType("setLightTheme", (evt) => {
					this.handleSetLightTheme(evt.theme);
				});

				this.bridge.onEventType("setDarkTheme", (evt) => {
					this.handleSetDarkTheme(evt.theme);
				});

				// Observe color scheme changes once and delegate to bridge
				this.colorSchemeObserver = new MutationObserver(() => {
					const newColorScheme = getComputedStyle(document.body)
						.colorScheme as ColorScheme;
					if (newColorScheme && newColorScheme !== this.colorScheme) {
						this.bridge!.setColorScheme(newColorScheme);
						this.colorScheme = newColorScheme;
					}
				});
				this.colorSchemeObserver.observe(document.body, {
					attributes: true,
					attributeFilter: ["class"],
				});

				await this.bridge.connect();
			}
			
			const source = this.fileFrontmatter?.["source"] as string;

			let trimmedSource = source.trim();
			let sourceType: "local" | "url" = "local";

			if (
				trimmedSource.startsWith("http://") ||
				trimmedSource.startsWith("https://")
			) {
				sourceType = "url";
			} else {
				sourceType = "local";
				trimmedSource = trimmedSource.replace(/^\[\[|\]\]$/g, "");
			}

			const extension = trimmedSource.split(".").pop();
			if (!extension) throw new Error("Invalid file extension");
			let readerType: "pdf" | "epub" | "snapshot";
			switch (extension.toLowerCase()) {
				case "pdf":
					readerType = "pdf";
					break;
				case "epub":
					readerType = "epub";
					break;
				case "html":
					readerType = "snapshot";
					break;
				default:
					throw new Error("Unsupported file type: " + extension);
			}

			// Parse annotations from the current markdown file
			const annotations = await this.parseAnnotationsFromFile();

			// Get stored view states from frontmatter
			const primaryViewState = this.fileFrontmatter?.[
				"primaryViewState"
			] as Record<string, unknown> | undefined;
			const secondaryViewState = this.fileFrontmatter?.[
				"secondaryViewState"
			] as Record<string, unknown> | undefined;
			const extraOptions = this.fileFrontmatter?.["options"] as
				| Partial<CreateReaderOptions>
				| undefined;

			const opts = {
				...this.state.readerOptions,
				colorScheme: this.colorScheme,
				annotations: annotations,
				primaryViewState,
				secondaryViewState,
				customThemes: this.plugin.settings.readerThemes,
				sidebarPosition: this.plugin.settings.sidebarPosition,
				...extraOptions,
			};

			switch (sourceType) {
				case "local":
					const localFile =
						this.app.vault.getFileByPath(trimmedSource);
					if (!localFile || !(localFile instanceof TFile)) {
						throw new Error(
							"Local file not found:" + trimmedSource
						);
					}
					const arrayBuffer = await this.app.vault.readBinary(
						localFile
					);

					await this.bridge.initReader({
						data: { buf: new Uint8Array(arrayBuffer) },
						type: readerType,
						...opts,
					});
					break;
				case "url":
					await this.bridge.initReader({
						data: { url: trimmedSource },
						type: readerType,
						...opts,
					});
					break;
				default:
					throw new Error(
						"Unknown source type:" + sourceType
					);
			}
		} catch (e) {
			console.error("Error loading Zotero Reader view:", e);
			container.empty();
			const errorMessage = createDiv({
				cls: "error-message",
			});
			errorMessage
				.createEl("span")
				.appendText("Failed to load Zotero Reader");
			errorMessage
				.createEl("span")
				.appendText("Error details: " + e.message);
			container.appendChild(errorMessage);
		}
	}

	/**
	 * Parse annotations from the current markdown file
	 */
	private async parseAnnotationsFromFile(): Promise<ZoteroAnnotation[]> {
		if (!this.annotationManager) {
			return [];
		}

		try {
			console.log(
				"Parsing annotations from file:",
				this.annotationManager
			);

			const annotations = [];

			for (const [key, value] of this.annotationManager.annotationMap) {
				annotations.push({
					...value.json,
					text: value.text,
					comment: value.comment,
				});
			}

			// Extract ZoteroAnnotation
			return annotations;
		} catch (error) {
			console.error("Error parsing annotations from file:", error);
			return [];
		}
	}

	private async handleViewStateChanged(state: unknown, primary: boolean) {
		if (!this.file || !this.fileFrontmatter) return;

		try {
			const key = primary ? "primaryViewState" : "secondaryViewState";
			await this.updateFrontmatterProperty(key, state as Object);

			// Update local frontmatter cache
			if (primary) {
				this.fileFrontmatter.primaryViewState = state;
			} else {
				this.fileFrontmatter.secondaryViewState = state;
			}
		} catch (error) {
			console.error("Error updating view state in frontmatter:", error);
		}
	}

	private async updateFrontmatterProperty(key: string, value: unknown) {
		if (!this.file) return;

		await this.app.fileManager.processFrontMatter(this.file, (fm) => {
			if (
				value === undefined ||
				value === null ||
				(typeof value === "object" &&
					value !== null &&
					Object.keys(value).length === 0)
			)
				delete fm[key];
			else fm[key] = value;
		});

		// Refresh the frontmatter cache after modification
		await this.refreshFrontmatter();
	}

	private async refreshFrontmatter() {
		if (!this.file) return;

		// Wait a bit for the metadata cache to update
		setTimeout(async () => {
			const content = await this.app.vault.read(this.file!);

			const info = getFrontMatterInfo(content);

			if (!info || !info.frontmatter) return;

			// turn the YAML string into a JS object
			this.fileFrontmatter = parseYaml(info.frontmatter) as Record<
				string,
				unknown
			>;
		}, 100);
	}

	private async updateOptionsInFrontmatter(
		options: Partial<CreateReaderOptions>
	) {
		if (!this.file || !this.fileFrontmatter) return;

		try {
			const key = "options";
			const currentOptions =
				(this.fileFrontmatter
					.options as Partial<CreateReaderOptions>) || {};
			const newOptions = { ...currentOptions, ...options };
			await this.updateFrontmatterProperty(key, newOptions);
			this.fileFrontmatter.options = newOptions;
		} catch (error) {
			console.error("Error updating options in frontmatter:", error);
		}
	}

	private async handleSidebarToggled(open: boolean) {
		// Handle sidebar toggled event
		if (!this.file || !this.fileFrontmatter) return;

		try {
			await this.updateOptionsInFrontmatter({ sidebarOpen: open });
		} catch (error) {
			console.error(
				"Error updating sidebar state in frontmatter:",
				error
			);
		}
	}

	private async handleSidebarWidthChanged(width: number) {
		// Handle sidebar width changed event
		if (!this.file || !this.fileFrontmatter) return;

		try {
			await this.updateOptionsInFrontmatter({ sidebarWidth: width });
		} catch (error) {
			console.error(
				"Error updating sidebar width in frontmatter:",
				error
			);
		}
	}

	private async handleAnnotationsSaved(annotations: ZoteroAnnotation[]) {
		if (!this.annotationManager) return;

		const [update, create] = annotations.reduce(
			([pass, fail], item) =>
				this.annotationManager!.annotationMap.has(item.id)
					? [[...pass, item], fail]
					: [pass, [...fail, item]],
			[[], []]
		);

		for (const annotation of create) {
			await this.annotationManager.addAnnotation({
				json: annotation,
			});
		}

		for (const annotation of update) {
			await this.annotationManager.updateAnnotation(annotation.id, {
				json: annotation,
			});
		}
	}

	private async handleAnnotationsDeleted(annotationIds: string[]) {
		if (!this.annotationManager) return;

		for (const id of annotationIds) {
			await this.annotationManager.removeAnnotation(id);
		}
	}

	private async handleCustomThemesSaved(customThemes: any) {
		// Handle custom themes saved event
		this.plugin.settings.readerThemes = customThemes;
		await this.plugin.saveSettings();
		console.log("Custom themes updated in plugin settings.");
	}

	private async handleSetLightTheme(theme: any) {
		// Handle theme set event
		if (!this.file || !this.fileFrontmatter) return;

		try {
			await this.updateOptionsInFrontmatter({ lightTheme: theme });
		} catch (error) {
			console.error("Error updating theme in frontmatter:", error);
		}
	}

	private async handleSetDarkTheme(theme: any) {
		// Handle theme set event
		if (!this.file || !this.fileFrontmatter) return;

		try {
			await this.updateOptionsInFrontmatter({ darkTheme: theme });
		} catch (error) {
			console.error("Error updating theme in frontmatter:", error);
		}
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (
			this.state &&
			this.state.mdSourceFilePath &&
			this.file &&
			this.fileFrontmatter &&
			this.fileFrontmatter["source"]
		) {
			const source = (this.fileFrontmatter["source"] as string).trim();
			if (typeof source === "string") {
				const trimmedSource = source.trim().replace(/^\[\[|\]\]$/g, "");
				const sourceText =
					trimmedSource.split("/").pop() || trimmedSource;

				return `${sourceText} (${this.file.name})`;
			}
		}
		return "Zotero Reader";
	}

	async onOpen() {
		console.log("Reloading reader view");

		// Find the actions element in the header, similar to main.ts approach
		const actionsEl = (this as any).actionsEl as HTMLElement | undefined;

		if (!actionsEl) return;

		const btnContainer = document.createElement("div");
		btnContainer.id = this.TOGGLE_MARKDOWN_CONTAINER_ID;
		actionsEl.prepend(btnContainer);

		// Create a button and insert it into the actions area (next to "pencil/more")
		const btn = new ButtonComponent(btnContainer);
		btn.setIcon("file-text");
		btn.setClass("clickable-icon");
		btn.setClass("view-action");
		btn.setTooltip("Open as Zotero Reader");
		btn.onClick(async () => {
			await this.bridge?.dispose();
			await this.leaf.setViewState({
				type: "markdown",
				state: this.state.sourceViewState,
				active: true,
			});
		});

		this.renderReader();
	}

	async onClose() {
		this.colorSchemeObserver?.disconnect();
		this.colorSchemeObserver = undefined;
		await this.bridge?.dispose();
		const container = this.containerEl;
		container.empty();
	}
}
