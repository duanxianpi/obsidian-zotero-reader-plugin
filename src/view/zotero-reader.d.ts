export type Theme = "light" | "dark";

export interface CreateReaderOptions {
	data: { buf: Uint8Array } | { url: string };
    type: string;
	sidebarOpen?: boolean;
	obsidianTheme: Theme;
}

export interface InitPayload {
	blobUrlMap: Record<string, string>;
	obsidianThemeVariables: Record<string, Record<string, string>>;
	theme: Theme;
	version: string; // simple wire versioning
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
};

export type ChildApi = {
	// parent → child
	init: (payload: InitPayload) => Promise<{ ok: true }>;
	createReader: (opts: CreateReaderOptions) => Promise<{ ok: true }>;
	setTheme: (theme: Theme) => Promise<{ ok: true }>;
	dispose: () => Promise<{ ok: true }>;
};
