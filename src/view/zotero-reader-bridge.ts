import { WindowMessenger, connect, Connection, RemoteProxy } from "penpal";
import type {
	ChildApi,
	ParentApi,
	CreateReaderOptions,
	ColorScheme,
	ChildEvents,
} from "../types/zotero-reader";
import { createEmbeddableMarkdownEditor } from "../editor/markdownEditor";

type BridgeState = "idle" | "connecting" | "ready" | "disposing" | "disposed";

export class IframeReaderBridge {
	private iframe: HTMLIFrameElement | null = null;
	private conn?: Connection<ChildApi>;
	private remote?: RemoteProxy<ChildApi>;
	private state: BridgeState = "idle";
	private queue: (() => Promise<void>)[] = [];
	private listeners = new Set<(e: ChildEvents) => void>();
	private connectTimeoutMs = 8000;

	constructor(
		private container: HTMLElement,
		private src: string,
		private allowedOrigins: string[] = ["*"]
	) {}

	onEvent(cb: (e: ChildEvents) => void) {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	async connect() {
		if (this.state !== "idle") return;
		this.state = "connecting";

		// Create iframe once
		this.iframe = document.createElement("iframe");
		this.iframe.id = "zotero-reader-iframe";
		this.iframe.style.cssText = "width:100%;height:100%;border:none;";
		this.iframe.src = this.src;
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-same-origin");
		this.iframe.sandbox.add("allow-forms");

		this.container.replaceChildren(this.iframe);

		// Parent API exposed to child (event channel)
		const parentApi: ParentApi = {
			handleEvent: (evt) => this.listeners.forEach((l) => l(evt)),
			createEditor: async (containerSelector: string) => {
				const container =
					this.iframe!.contentDocument!.querySelector(
						containerSelector
					);
				if (!container) {
					throw new Error(
						`Container not found: ${containerSelector}`
					);
				}
				createEmbeddableMarkdownEditor(
					(window as any).app,
					container as HTMLElement,
					{}
				);
				return { ok: true };
			},
		};

		const messenger = new WindowMessenger({
			remoteWindow: this.iframe.contentWindow!,
			allowedOrigins: this.allowedOrigins,
		});

		this.conn = connect<ChildApi>({
			messenger,
			methods: parentApi,
		});

		// Wait for child proxy with a timeout
		const remotePromise = this.conn.promise;
		const remote = await Promise.race([
			remotePromise,
			new Promise<never>((_, rej) =>
				setTimeout(
					() => rej(new Error("Child connect timeout")),
					this.connectTimeoutMs
				)
			),
		]);
		this.remote = remote;
		this.state = "ready";

		// Drain queued calls
		const tasks = [...this.queue];
		this.queue.length = 0;
		for (const t of tasks) await t();
	}

	private enqueueOrRun(fn: () => Promise<void>) {
		if (this.state === "ready") return fn();
		if (this.state === "connecting") {
			this.queue.push(fn);
			return Promise.resolve();
		}
		return Promise.reject(
			new Error(`Bridge not ready (state=${this.state})`)
		);
	}

	initReader(opts: CreateReaderOptions) {
		return this.enqueueOrRun(async () => {
			await this.remote!.initReader(opts);
		});
	}

	setColorScheme(colorScheme: ColorScheme) {
		return this.enqueueOrRun(async () => {
			await this.remote!.setColorScheme(colorScheme);
		});
	}

	async dispose() {
		if (!this.conn || this.state === "disposed") return;
		this.state = "disposing";
		try {
			console.log("Disposing Zotero Reader bridge");
			await this.remote?.dispose();
		} finally {
			this.conn!.destroy();
			this.conn = undefined;
			this.remote = undefined;
			this.iframe?.remove();
			this.iframe = null;
			this.state = "disposed";
		}
	}
}
