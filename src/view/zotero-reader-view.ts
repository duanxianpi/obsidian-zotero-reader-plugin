import {
	WorkspaceLeaf,
	TFile,
	ViewStateResult,
	ItemView,
	getIcon,
	ButtonComponent,
} from "obsidian";
import { IframeReaderBridge } from "./zotero-reader-bridge";
import {
	ChildEvents,
	CreateReaderOptions,
	ColorScheme,
	ZoteroAnnotation,
} from "../types/zotero-reader";
import { AnnotationManager } from "./annotation-manager";

export const VIEW_TYPE = "zotero-reader-view";

interface ReaderViewState extends Record<string, unknown> {
	sourceFilePath: string;
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

	// State properties
	private state: ReaderViewState;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.colorScheme =
			(getComputedStyle(document.body).colorScheme as ColorScheme) ??
			"dark";
		this.icon = "zotero-icon";
	}

	async setState(
		state: ReaderViewState,
		result: ViewStateResult
	): Promise<void> {
		// Update internal state
		this.state = { ...this.state, ...state };
		await super.setState(state, result);

		this.file = this.app.vault.getFileByPath(this.state.sourceFilePath);
		if (!this.file || !(this.file instanceof TFile)) {
			return;
		}

		this.fileFrontmatter = this.app.metadataCache.getFileCache(this.file)
			?.frontmatter as Record<string, unknown> | undefined;

		if (!this.fileFrontmatter) {
			return;
		}

		// Get file content
		const content = await this.app.vault.read(this.file);

		// Initialize annotation manager
		this.annotationManager = new AnnotationManager(
			this.app.vault,
			this.app.metadataCache,
			this.file,
			content
		);

		// Reload view
		this.renderReader();
	}

	getState(): ReaderViewState {
		return this.state;
	}

	navigateToAnnotation(annotationId: string) {
		if (!this.bridge) return;

		this.bridge.navigateToAnnotation(annotationId);
	}

	private async renderReader() {
		if (
			!this.state ||
			!this.state.sourceFilePath ||
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
					this.state.sourceFilePath
				);

				// Register event listeners
				this.bridge.onEventType("error", (evt) => {
					console.error(`${evt.code}: ${evt.message}`);
				});

				this.bridge.onEventType("ready", (evt) => {
					console.log("Reader is ready");
				});

				this.bridge.onEventType("sidebarToggled", (evt) => {
					console.log("Sidebar toggled:", evt.open);
				});

				this.bridge.onEventType("openLink", (evt) => {
					console.log("Opening link:", evt.url);
					// Handle link opening logic here
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

			// Update the source file path in the bridge
			if (this.bridge && this.file?.path) {
				this.bridge.setSourceFilePath(this.file.path);
			}

			const source = this.fileFrontmatter?.["source"] as string;

			const trimmedSource = source.trim();
			let sourceType: "local" | "url" = "local";

			if (
				trimmedSource.startsWith("http://") ||
				trimmedSource.startsWith("https://")
			) {
				sourceType = "url";
			} else {
				sourceType = "local";
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

			const opts = {
				...this.state.readerOptions,
				colorScheme: this.colorScheme,
				annotations: annotations,
				sidebarOpen: false,
				primaryViewState,
				secondaryViewState,
			};

			switch (sourceType) {
				case "local":
					const localFile =
						this.app.vault.getFileByPath(trimmedSource);
					if (!localFile || !(localFile instanceof TFile)) {
						throw new Error(
							"Local file not found:" + this.state.source
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
						"Unknown source type:" + this.state.sourceType
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
			fm[key] = value;
		});

		// Refresh the frontmatter cache after modification
		await this.refreshFrontmatter();
	}

	private async refreshFrontmatter() {
		if (!this.file) return;

		// Wait a bit for the metadata cache to update
		setTimeout(() => {
			this.fileFrontmatter = this.app.metadataCache.getFileCache(
				this.file!
			)?.frontmatter as Record<string, unknown> | undefined;
		}, 100);
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

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (
			this.state &&
			this.state.sourceFilePath &&
			this.file &&
			this.fileFrontmatter &&
			this.fileFrontmatter["source"]
		) {
			const source = (this.fileFrontmatter["source"] as string).trim();
			if (typeof source === "string") {
				if (
					source.startsWith("http://") ||
					source.startsWith("https://")
				) {
					return `${source.split("/").pop() || source} (${
						this.file.name
					})`;
				} else {
					return `${source} (${this.file.name})`;
				}
			}
		}
		return "Zotero Reader";
	}

	async onOpen() {
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
