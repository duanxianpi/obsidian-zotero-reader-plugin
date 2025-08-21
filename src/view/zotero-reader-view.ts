import {
	WorkspaceLeaf,
	TFile,
	ViewStateResult,
	ItemView,
	App,
	getIcon,
} from "obsidian";
import { IframeReaderBridge } from "./zotero-reader-bridge";
import { ChildEvents, CreateReaderOptions, Theme } from "./zotero-reader";

export const VIEW_TYPE = "zotero-reader-view";

interface ReaderViewState extends Record<string, unknown> {
	mdFile: TFile | null; // Current obsidian file path
	mdFrontmatter: Record<string, unknown>; // Full frontmatter data
	noteId: string; // noteid from frontmatter
	sourceType: "local" | "url" | "obsidian-uri";
	source: string; // The actual source URL/path
}

export class ZoteroReaderView extends ItemView {
	private bridge?: IframeReaderBridge;
	private themeObserver?: MutationObserver;
	private theme: Theme;

	// State properties
	private state: ReaderViewState;

	constructor(
		leaf: WorkspaceLeaf,
	) {
		super(leaf);
		this.theme =
			(getComputedStyle(document.body).colorScheme as Theme) ?? "dark";
		this.icon = "zotero-icon";
	}

	async setState(
		state: ReaderViewState,
		result: ViewStateResult
	): Promise<void> {
		// Update internal state
		this.state = { ...this.state, ...state };

		await super.setState(state, result);

		// Reload view
		this.render();
	}

	getState(): ReaderViewState {
		return this.state;
	}

	async render() {
		try {
			if (
				!this.state ||
				!this.state?.mdFile ||
				this.state?.noteId.length === 0 ||
				this.state?.source.length === 0 ||
				this.state?.mdFrontmatter === undefined
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

			const extension = this.state.source.split(".").pop();
			if (!extension) throw new Error("Invalid file extension");
			let type: "pdf" | "epub" | "snapshot";
			switch (extension.toLowerCase()) {
				case "pdf":
					type = "pdf";
					break;
				case "epub":
					type = "epub";
					break;
				case "html":
					type = "snapshot";
					break;
				default:
					throw new Error("Unsupported file type: " + extension);
			}

			switch (this.state.sourceType) {
				case "local":
					const file = this.app.vault.getAbstractFileByPath(
						this.state.source
					);
					if (!file || !(file instanceof TFile)) {
						throw new Error(
							"Local file not found:" + this.state.source
						);
					}

					const arrayBuffer = await this.app.vault.readBinary(file);
					await this.initializeReader({
						data: { buf: new Uint8Array(arrayBuffer) },
						type: type,
						obsidianTheme: this.theme,
					});
					break;
				case "url":
					await this.initializeReader({
						data: { url: this.state.source },
						type: type,
						obsidianTheme: this.theme,
					});
					break;
				default:
					throw new Error(
						"Unknown source type:" + this.state.sourceType
					);
			}
		} catch (e) {
			console.error("Error loading Zotero Reader view:", e);
			this.containerEl.children[1].empty();
			const errorMessage = createDiv({
				cls: "error-message",
			});
			errorMessage.setText("Failed to load Zotero Reader");
			this.containerEl.children[1].appendChild(errorMessage);
		}
	}

	async initializeReader(opts: CreateReaderOptions) {
		const container = this.containerEl.children[1] as HTMLElement;
		// Create bridge once
		if (!this.bridge) {
			container.style.overflow = "hidden";
			container.style.padding = "unset";

			this.bridge = new IframeReaderBridge(
				container,
				(window as any).BLOB_URL_MAP["reader.html"],
				["app://obsidian.md"]
			);

			this.bridge.onEvent((evt: ChildEvents) => {
				if (evt.type === "error") {
					console.error(`${evt.code}: ${evt.message}`);
				}
			});

			await this.bridge.connect();

			// Observe theme changes once and delegate to bridge
			this.themeObserver = new MutationObserver(() => {
				const newTheme = getComputedStyle(document.body)
					.colorScheme as Theme;
				if (newTheme && newTheme !== this.theme) {
					this.bridge!.setTheme(newTheme);
					this.theme = newTheme;
				}
			});
			this.themeObserver.observe(document.body, {
				attributes: true,
				attributeFilter: ["class"],
			});
		}
		await this.bridge.initReader(opts);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (this.state && this.state.sourceType && this.state.source) {
			switch (this.state.sourceType) {
				case "local":
					return `${this.state.source} (${this.state.mdFile?.path})`;
				case "url":
					return `${
						this.state.source.split("/").pop() || this.state.source
					} (${this.state.mdFile?.name})`;
				default:
					return "Zotero Reader";
			}
		}

		return "Zotero Reader";
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		this.themeObserver?.disconnect();
		this.themeObserver = undefined;
		await this.bridge?.dispose();
		const container = this.containerEl.children[1];
		container.empty();
	}
}
