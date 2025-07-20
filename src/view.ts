import { FileView, WorkspaceLeaf, TFile } from "obsidian";
import { Connection, RemoteProxy, WindowMessenger, connect } from "penpal";

export const VIEW_TYPE = "obsidian-zotero-reader";
export const SUPPORTED_EXTENSIONS = ["pdf", "epub", "html"];

type ReaderApi = {
	init: (blobUrls: Record<string, string>) => Promise<boolean>;
	createReader: (options: {
		data: { buf: ArrayBuffer; url: string };
		type: string;
	}) => Promise<void>;
};

export class ZoteroReaderView extends FileView {
	data: ArrayBuffer | null = null;
	BLOB_URL_MAP: Record<string, string> = {};
	_iframe: HTMLIFrameElement | null = null;
	_readerConnection: Connection<ReaderApi> | null = null;
	_readerRemote: RemoteProxy<ReaderApi> | null = null;
	_isReaderReady: boolean = false;

	constructor(leaf: WorkspaceLeaf, BLOB_URL_MAP: Record<string, string>) {
		super(leaf);
		this.BLOB_URL_MAP = BLOB_URL_MAP;
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		if (this.file) {
			return this.file.basename;
		}
		return "Zotero PDF Reader";
	}

	// This determines which file types this view can handle
	canAcceptExtension(extension: string) {
		return SUPPORTED_EXTENSIONS.includes(extension);
	}

	// This determines the view type for a given file
	getViewData() {
		return this.data;
	}

	// Called when the view data changes
	setViewData(data: string, clear: boolean) {
		// For PDF files, we handle binary data differently
		if (clear) {
			this.clear();
		}
		// this.render();
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
				style: "width: 100%; height: 100%; border: none;",
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
	async onLoadFile(file: TFile) {
		this.file = file;
		if (SUPPORTED_EXTENSIONS.includes(file.extension)) {
			const type =
				file.extension === "pdf"
					? "pdf"
					: file.extension === "epub"
					? "epub"
					: "snapshot";
			// Load PDF data
			const arrayBuffer = await this.app.vault.readBinary(file);

			// Prepare the iframe
			this._iframe = this.prepareIframe();

			// Setup Penpal connection
			this._iframe.onload = async () => {
				await this.setupReaderConnection();

				if (this._readerRemote) {
					await this._readerRemote.createReader({
						data: { buf: new Uint8Array(arrayBuffer), url: "" },
						type: type,
					});
				} else {
					console.error(
						"Error initializing reader:",
						this._readerConnection
					);
				}
			};

			// Append the iframe to the view
			this.containerEl.children[1].empty();
			this.containerEl.children[1].appendChild(this._iframe);
		}
	}
}
