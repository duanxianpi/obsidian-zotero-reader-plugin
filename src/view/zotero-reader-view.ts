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
} from "../types/zotero-reader";
import { createEmbeddableMarkdownEditor } from "../editor/markdownEditor";

export const VIEW_TYPE = "zotero-reader-view";

interface ReaderViewState extends Record<string, unknown> {
	file: TFile;
	previousViewState: Record<string, unknown>;
	previousViewType: string;
}

export class ZoteroReaderView extends ItemView {
	private TOGGLE_MARKDOWN_CONTAINER_ID = "toggle-markdown-icon";

	private bridge?: IframeReaderBridge;
	private colorSchemeObserver?: MutationObserver;
	private colorScheme: ColorScheme;

	// State properties
	private state: ReaderViewState;

	private fileFrontmatter: Record<string, unknown> | undefined;

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
		console.log("Zotero Reader View state updated:", this.state);

		this.fileFrontmatter = this.app.metadataCache.getFileCache(
			this.state.file
		)?.frontmatter as Record<string, unknown> | undefined;

		// Reload view
		this.renderReader();
	}

	getState(): ReaderViewState {
		return this.state;
	}

	async renderReader() {
		if (
			!this.state ||
			!this.state.file ||
			!this.state.previousViewState ||
			!this.state.previousViewType
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
		this.containerEl.children[1].appendChild(loader);
		
		try {
			await this.initializeReader();
		} catch (e) {
			console.error("Error loading Zotero Reader view:", e);
			this.containerEl.children[1].empty();
			const errorMessage = createDiv({
				cls: "error-message",
			});
			errorMessage
				.createEl("span")
				.appendText("Failed to load Zotero Reader");
			errorMessage
				.createEl("span")
				.appendText("Error details: " + e.message);
			this.containerEl.children[1].appendChild(errorMessage);
		}
	}

	async initializeReader() {
		const container = this.containerEl.children[1] as HTMLElement;
		// Create bridge once
		if (!this.bridge) {
			container.style.overflow = "hidden";
			container.style.padding = "unset";

			this.bridge = new IframeReaderBridge(
				container,
				(window as any).BLOB_URL_MAP["reader.html"],
				["*"]
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
			});

			this.bridge.onEventType("viewStateChanged", (evt) => {
				console.log(
					"View state changed:",
					evt.state,
					"Primary:",
					evt.primary
				);
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

		const trimmedSource = source.trim();
		let sourceType: "local" | "url" = "local";

		if (typeof source === "string") {
			if (
				trimmedSource.startsWith("http://") ||
				trimmedSource.startsWith("https://")
			) {
				sourceType = "url";
			} else {
				sourceType = "local";
			}
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

		const opts = { colorScheme: this.colorScheme };

		switch (sourceType) {
			case "local":
				const localFile = this.app.vault.getFileByPath(trimmedSource);
				if (!localFile || !(localFile instanceof TFile)) {
					throw new Error(
						"Local file not found:" + this.state.source
					);
				}
				const arrayBuffer = await this.app.vault.readBinary(localFile);

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
				throw new Error("Unknown source type:" + this.state.sourceType);
		}
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (
			this.state &&
			this.state.file &&
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
						this.state.file.name
					})`;
				} else {
					return `${source} (${this.state.file.name})`;
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
				type: this.state.previousViewType,
				state: this.state.previousViewState,
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
