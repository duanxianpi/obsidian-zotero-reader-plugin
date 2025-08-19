import { WorkspaceLeaf, TFile, ViewStateResult, ItemView, App } from "obsidian";
import { Connection, RemoteProxy, WindowMessenger, connect } from "penpal";
import { extractObsidianStyles } from "./utils";

export const VIEW_TYPE = "obsidian-zotero-reader";

type ReaderOptions = {
	data: { buf: Uint8Array; url: string };
	type: string;
	theme: string;
	sidebarOpen: boolean;
};

type ReaderApi = {
	init: (
		blobUrls: Record<string, string>,
		obsidianStyles: Record<string, Record<string, string>>,
		theme: string
	) => Promise<boolean>;
	createReader: (options: ReaderOptions) => Promise<void>;
	toggleTheme: (originalTheme: string, newTheme: string) => Promise<void>;
};

interface ReaderViewState extends Record<string, unknown> {
	mdFile: TFile | null; // Current obsidian file path
	mdFrontmatter: Record<string, unknown>; // Full frontmatter data
	noteId: string; // noteid from frontmatter
	sourceType: "local" | "url" | "obsidian-uri";
	sourceUrl: string; // The actual source URL/path
}

export class ZoteroReaderView extends ItemView {
	BLOB_URL_MAP: Record<string, string>;
	obsidianStyles: Record<string, Record<string, string>>;

	theme: string;
	iframe: HTMLIFrameElement;
	readerConnection: Connection<ReaderApi>;
	readerRemote: RemoteProxy<ReaderApi>;
	isReaderReady: boolean = false;
	themeObserver: MutationObserver | null = null;

	// State properties
	private state: ReaderViewState = {
		mdFile: null,
		noteId: "",
		sourceType: "local",
		sourceUrl: "",
		mdFrontmatter: {},
	};

	constructor(leaf: WorkspaceLeaf, BLOB_URL_MAP: Record<string, string>) {
		super(leaf);
		this.BLOB_URL_MAP = BLOB_URL_MAP;
		this.theme = getComputedStyle(document.body).colorScheme;
	}

	async setState(
		state: ReaderViewState,
		result: ViewStateResult
	): Promise<void> {
		// Update internal state
		this.state = { ...this.state, ...state };

		await super.setState(state, result);

		// Process the different source types
		await this.processReaderSource();
	}

	getState(): ReaderViewState {
		return this.state;
	}

	private async processReaderSource(): Promise<void> {
		console.log("Processing reader source:", this.state);

		if (!this.state.sourceType || !this.state.sourceUrl) {
			console.warn("No source type or URL specified");
			return;
		}

		try {
			switch (this.state.sourceType) {
				case "local":
					await this.loadLocalFile();
					break;
				case "url":
					await this.loadFromUrl();
					break;
				case "obsidian-uri":
					await this.loadFromObsidianUri();
					break;
				default:
					console.warn("Unknown source type:", this.state.sourceType);
			}
		} catch (error) {
			console.error("Error processing reader source:", error);
		}
	}

	private async loadLocalFile(): Promise<void> {
		if (!this.state.sourceUrl) return;

		// Get the file from vault
		const file = this.app.vault.getAbstractFileByPath(this.state.sourceUrl);
		if (!file || !(file instanceof TFile)) {
			console.error("Local file not found:", this.state.sourceUrl);
			return;
		}

		// Determine file type
		const fileExtension = file.extension.toLowerCase();
		const type =
			fileExtension === "pdf"
				? "pdf"
				: fileExtension === "epub"
				? "epub"
				: "snapshot";

		// Load file data
		const arrayBuffer = await this.app.vault.readBinary(file);

		// Initialize reader with local file
		await this.initializeReader({
			data: { buf: new Uint8Array(arrayBuffer), url: "" },
			type: type,
			sidebarOpen: false,
			theme: this.theme,
		});
	}

	private async loadFromUrl(): Promise<void> {
		if (!this.state.sourceUrl) return;

		// For URLs, we'll need to fetch the content
		// This is a placeholder - you might want to implement actual URL fetching
		console.log("Loading from URL:", this.state.sourceUrl);

		// You can implement URL fetching here or pass the URL directly to the reader
		// For now, let's pass the URL to the reader to handle
		await this.initializeReader({
			data: { buf: new Uint8Array(), url: this.state.sourceUrl },
			type: "pdf", // Default to PDF, you might want to detect this
			sidebarOpen: false,
			theme: this.theme,
		});
	}

	private async loadFromObsidianUri(): Promise<void> {
		if (!this.state.sourceUrl) return;

		try {
			// Parse the Obsidian URI
			const url = new URL(this.state.sourceUrl);
			const fileParam = url.searchParams.get("file");
			const vaultParam = url.searchParams.get("vault");

			if (!fileParam) {
				console.error("No file parameter in Obsidian URI");
				return;
			}

			console.log("Loading from Obsidian URI:", {
				vault: vaultParam,
				file: fileParam,
			});

			// Try to load the file from the current vault
			const file = this.app.vault.getAbstractFileByPath(fileParam);
			if (file && file instanceof TFile) {
				// File exists in current vault, load it
				const fileExtension = file.extension.toLowerCase();
				const type =
					fileExtension === "pdf"
						? "pdf"
						: fileExtension === "epub"
						? "epub"
						: "snapshot";

				const arrayBuffer = await this.app.vault.readBinary(file);

				await this.initializeReader({
					sidebarOpen: false,
					data: { buf: new Uint8Array(arrayBuffer), url: "" },
					type: type,
					theme: this.theme,
				});
			} else {
				// File not found in current vault
				console.warn("File not found in current vault:", fileParam);
				// You might want to show an error message or try to open the URI externally
			}
		} catch (error) {
			console.error("Error parsing Obsidian URI:", error);
		}
	}

	private async initializeReader(options: ReaderOptions): Promise<void> {
		// Prepare the iframe
		this.iframe = createEl("iframe", {
			attr: {
				id: "zotero-reader-iframe",
				style: "width: 100%; height: 100%; border: none;",
				src: this.BLOB_URL_MAP["reader.html"],
				sandbox: "allow-scripts allow-same-origin",
			},
		});
		this.iframe.toggleVisibility(false);

		// Setup Penpal connection
		this.iframe.onload = async () => {
			await this.setupReaderConnection();

			// Setup reader theme and Listen for changes in the theme
			this.themeObserver = new MutationObserver(() => {
				const theme = getComputedStyle(document.body).colorScheme;

				if (theme != "normal" && this.theme != theme) {
					// Check if the connection is still active before calling remote method
					this.readerRemote.toggleTheme(this.theme, theme);
					this.theme = theme;
					console.log("Theme changed to:", theme);
				}
			});

			this.themeObserver.observe(document.body, {
				attributes: true,
				attributeFilter: ["class"],
			});

			if (this.readerRemote) {
				await this.readerRemote.createReader(options);
				this.isReaderReady = true;

				// When the reader is ready, show the iframe
				this.iframe?.toggleVisibility(true);
			} else {
				console.error(
					"Error initializing reader:",
					this.readerConnection
				);
			}
		};

		// Append the iframe to the view
		this.containerEl.children[1].empty();
		(this.containerEl.children[1] as HTMLElement).style.overflow = "hidden";
		(this.containerEl.children[1] as HTMLElement).style.padding = "unset";
		this.containerEl.children[1].appendChild(this.iframe);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (this.state.sourceType && this.state.sourceUrl) {
			const fileName =
				this.state.sourceUrl.split("/").pop() || "Unknown File";
			return `Zotero Reader - ${fileName}`;
		}
		return "Zotero Reader";
	}

	// Clear the view
	clear() {
		const container = this.containerEl.children[1];
		container.empty();
	}

	async setupReaderConnection() {
		if (!this.iframe?.contentWindow) return;

		try {
			const messenger = new WindowMessenger({
				remoteWindow: this.iframe.contentWindow,
				allowedOrigins: ["app://obsidian.md"],
			});

			const connection = connect<ReaderApi>({
				messenger,
				// Methods the parent window is exposing to the iframe window.
				methods: {
					multiply(num1: number, num2: number) {
						return num1 * num2;
					},
				},
			});
			const remote = await connection.promise;

			if (
				await remote.init(
					this.BLOB_URL_MAP,
					extractObsidianStyles(),
					this.theme
				)
			) {
				this.readerConnection = connection;
				this.readerRemote = remote;
			}
		} catch (error) {
			console.error("Error setting up Penpal connection:", error);
		}
	}

	async onOpen() {
		console.log("onOpen Called");
	}

	async onClose() {
		// Clean up MutationObserver
		if (this.themeObserver) {
			this.themeObserver.disconnect();
			this.themeObserver = null;
		}

		// Mark as not ready to prevent further remote calls
		this.isReaderReady = false;

		// Clean up reader instance and Penpal connection
		if (this.readerConnection) {
			try {
				this.readerConnection.destroy();
			} catch (error) {
				console.error("Error destroying Penpal connection:", error);
			}
		}
	}

	// Handle file loading
	async onload() {
		// Anything need to be done when the view is created
	}
}
