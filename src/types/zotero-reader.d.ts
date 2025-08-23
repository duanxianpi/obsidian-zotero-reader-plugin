export type ColorScheme = "light" | "dark";

export interface CreateReaderOptions {
	data: { buf: Uint8Array } | { url: string };
	type: string;
	sidebarOpen?: boolean;
	colorScheme: ColorScheme;
}

export type ChildEvents =
	| { type: "ready" }
	| { type: "error"; code: string; message: string }
	| { type: "viewStateChanged"; state: unknown; primary: boolean }
	| { type: "annotationsSaved"; count: number }
	| { type: "sidebarToggled"; open: boolean }
	| { type: "openLink"; url: string };

export type ParentApi = {
	// child → parent
	handleEvent: (evt: ChildEvents) => void;
	createEditor: (containerSelector: string) => Promise<{ ok: true }>;
};

export type ChildApi = {
	// parent → child
	initReader: (opts: CreateReaderOptions) => Promise<{ ok: true }>;
	setColorScheme: (colorScheme: ColorScheme) => Promise<{ ok: true }>;
	dispose: () => Promise<{ ok: true }>;
};
