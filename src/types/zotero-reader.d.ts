
export type ColorScheme = "light" | "dark";

export interface CreateReaderOptions {
	data: { buf: Uint8Array } | { url: string };
	type: string;
	sidebarOpen?: boolean;
	colorScheme: ColorScheme;
	annotations: ZoteroAnnotation[];
}

export type ChildEvents =
	| { type: "ready" }
	| { type: "error"; code: string; message: string }
	| { type: "addToNote" }
	| { type: "annotationsSaved"; annotations: ZoteroAnnotation[] }
	| { type: "annotationsDeleted"; ids: string }
	| { type: "viewStateChanged"; state: unknown; primary: boolean }
	| {
			type: "openTagsPopup";
			annotationID: unknown;
			left: number;
			top: number;
	  }
	| { type: "closePopup"; data: unknown }
	| { type: "openLink"; url: string }
	| { type: "sidebarToggled"; open: boolean }
	| { type: "sidebarWidthChanged"; width: number }
	| {
			type: "setDataTransferAnnotations";
			dataTransfer: unknown;
			annotations: unknown;
			fromText: unknown;
	  }
	| {
			type: "confirm";
			title: string;
			text: string;
			confirmationButtonTitle: string;
	  }
	| { type: "rotatePages"; pageIndexes: unknown; degrees: unknown }
	| { type: "deletePages"; pageIndexes: unknown; degrees: unknown }
	| { type: "toggleContextPane" }
	| { type: "textSelectionAnnotationModeChanged"; mode: unknown }
	| { type: "saveCustomThemes"; customThemes: unknown };

export type ParentApi = {
	// child → parent
	handleEvent: (evt: ChildEvents) => void;
	createEditor: (containerSelector: string) => Promise<{ ok: true }>;
};

export type ChildApi = {
	// parent → child
	initReader: (opts: CreateReaderOptions) => Promise<{ ok: true }>;
	setColorScheme: (colorScheme: ColorScheme) => Promise<{ ok: true }>;
	destroy: () => Promise<{ ok: true }>;
};

export interface ZoteroPosition {
	pageIndex: number;
	rects: number[][];
}

export interface ZoteroAnnotation {
	type: string;
	color: string;
	sortIndex: string;
	pageLabel: string;
	position: ZoteroPosition;
	text: string;
	comment: string;
	tags: string[];
	id: string;
	dateCreated: string;
	dateModified: string;
	authorName: string;
	isAuthorNameAuthoritative: boolean;
	[key: string]: any; // Allow additional properties
}

export interface ParsedAnnotation {
	id: string;
	header?: string;
	text: string;
	comment: string;
	json: ZoteroAnnotation; // raw JSON object (parsed)
	range: { start: number; end: number };
	raw: string;
}
