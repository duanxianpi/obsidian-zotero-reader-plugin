import { WorkspaceLeaf, TFile, ViewStateResult, ItemView, App } from "obsidian";
import { Connection, RemoteProxy, WindowMessenger, connect } from "penpal";

export const VIEW_TYPE = "obsidian-zotero-reader";

type ReaderApi = {
	init: (blobUrls: Record<string, string>) => Promise<boolean>;
	createReader: (options: {
		data: { buf: Uint8Array; url: string };
		type: string;
	}) => Promise<void>;
};

interface ReaderViewState extends Record<string, unknown> {
	mdFile: TFile | null; // Current obsidian file path
	mdFrontmatter: Record<string, unknown>; // Full frontmatter data
	noteId: string; // noteid from frontmatter
	sourceType: "local" | "url" | "obsidian-uri";
	sourceUrl: string; // The actual source URL/path
}

export class ZoteroReaderView extends ItemView {
	
	BLOB_URL_MAP: Record<string, string> = {};
	_iframe: HTMLIFrameElement | null = null;
	_readerConnection: Connection<ReaderApi> | null = null;
	_readerRemote: RemoteProxy<ReaderApi> | null = null;
	_isReaderReady: boolean = false;
	
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
	}

	async setState(state: ReaderViewState, result: ViewStateResult): Promise<void> {
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
		const type = fileExtension === "pdf" ? "pdf" : 
					 fileExtension === "epub" ? "epub" : "snapshot";

		// Load file data
		const arrayBuffer = await this.app.vault.readBinary(file);
		
		// Initialize reader with local file
		await this.initializeReader({
			data: { buf: new Uint8Array(arrayBuffer), url: "" },
			type: type,
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

			console.log("Loading from Obsidian URI:", { vault: vaultParam, file: fileParam });
			
			// Try to load the file from the current vault
			const file = this.app.vault.getAbstractFileByPath(fileParam);
			if (file && file instanceof TFile) {
				// File exists in current vault, load it
				const fileExtension = file.extension.toLowerCase();
				const type = fileExtension === "pdf" ? "pdf" : 
							 fileExtension === "epub" ? "epub" : "snapshot";

				const arrayBuffer = await this.app.vault.readBinary(file);
				
				await this.initializeReader({
					data: { buf: new Uint8Array(arrayBuffer), url: "" },
					type: type,
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

	private async initializeReader(options: {
		data: { buf: Uint8Array; url: string };
		type: string;
	}): Promise<void> {
		// Prepare the iframe
		this._iframe = this.prepareIframe();

		// Setup Penpal connection
		this._iframe.onload = async () => {
			await this.setupReaderConnection();

			if (this._readerRemote) {
				await this._readerRemote.createReader(options);
				this._isReaderReady = true;
			} else {
				console.error("Error initializing reader:", this._readerConnection);
			}
		};

		// Append the iframe to the view
		this.containerEl.children[1].empty();
		this.containerEl.children[1].appendChild(this._iframe);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (this.state.sourceType && this.state.sourceUrl) {
			const fileName = this.state.sourceUrl.split('/').pop() || 'Unknown File';
			return `Zotero Reader - ${fileName}`;
		}
		return "Zotero Reader";
	}

	// Clear the view
	clear() {
		const container = this.containerEl.children[1];
		container.empty();
	}

	// prepare a iframe to display the reader UI
	prepareIframe() {
		const iframe = createEl("iframe", {
			attr: {
				id: "zotero-reader-iframe",
				style: "width: 100%; height: 99.5%; border: none;",
				src: this.BLOB_URL_MAP["reader.html"],
			},
		});

		return iframe;
	}

	async setupReaderConnection() {
		if (!this._iframe?.contentWindow) return;

		try {
			const messenger = new WindowMessenger({
				remoteWindow: this._iframe.contentWindow,
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

			if (await remote.init(this.BLOB_URL_MAP)) {
				this._readerConnection = connection;
				this._readerRemote = remote;
			}
		} catch (error) {
			console.error("Error setting up Penpal connection:", error);
		}
	}

	async onOpen() {
		// Anything need to be done when the view is created
	}

	async onClose() {
		// Clean up reader instance and Penpal connection
		if (this._readerConnection) {
			try {
				this._readerConnection.destroy();
			} catch (error) {
				console.error("Error destroying Penpal connection:", error);
			}
			this._readerConnection = null;
		}
		this._isReaderReady = false;
	}

	// Handle file loading
	async onload() {
		console.log("onload called");
	}
}
