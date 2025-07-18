import { FileView, WorkspaceLeaf, TFile } from "obsidian";

export const VIEW_TYPE = "obsidian-zotero-reader";
export const SUPPORTED_EXTENSIONS = ["pdf", "epub"];

export class ObsidianZoteroReaderView extends FileView {
	data: ArrayBuffer | null = null;
	BLOB_URL_MAP: Record<string, string> = {};
	_iframe: HTMLIFrameElement | null = null;

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

	// Render the PDF
	prepareContainer() {
		const container = this.containerEl.children[1];
		container.empty();

		// prepare a iframe to display the reader UI
		this._iframe = container.createEl("iframe");
		this._iframe.setAttribute("src", this.BLOB_URL_MAP["reader.html"]);
		this._iframe.setAttribute("style", "width: 100%; height: 100%; border: none;");
		
	}

	async onOpen() {
		// Anything need to be done when the view is created
	}

	async onClose() {
		// Clean up reader instance
	}

	// Handle file loading
	async onLoadFile(file: TFile) {
		this.file = file;
		if (SUPPORTED_EXTENSIONS.includes(file.extension)) {
			// Load PDF data
			const arrayBuffer = await this.app.vault.readBinary(file);
			this.data = arrayBuffer;
			this.prepareContainer();
		}
	}
}
