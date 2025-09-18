import type {
	ChildAPI,
	ParentAPI,
	CreateReaderOptions,
	ColorScheme,
	ChildEvents,
} from "../types/zotero-reader";

import {
	createEmbeddableMarkdownEditor,
	EmbeddableMarkdownEditor,
	MarkdownEditorProps,
} from "../editor/markdown-editor";

import { EditorView, ViewUpdate } from "@codemirror/view";
import { Platform } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { connect, WindowMessenger } from "penpal";

type BridgeState = "idle" | "connecting" | "ready" | "disposing" | "disposed";

// The bootstrap signature we temporarily install on the CHILD window.
type DirectBridgeBootstrap = () => {
	token: string;
	parent: ParentAPI;
	register: (childAPI: ChildAPI, token: string) => Promise<{ ok: boolean }>;
};

export class IframeReaderBridge {
	private iframe: HTMLIFrameElement | null = null;
	private child?: ChildAPI; // Direct reference to Child API (replaces RemoteProxy<ChildAPI>)
	private state: BridgeState = "idle";
	private queue: Array<() => Promise<void>> = [];
	private typedListeners = new Map<
		ChildEvents["type"],
		Set<(e: ChildEvents) => void>
	>();
	private connectTimeoutMs = 8000;

	private editorList: EmbeddableMarkdownEditor[] = [];
	private _readerOpts: CreateReaderOptions | undefined;

	private src = (window as any).BLOB_URL_MAP["reader.html"];
	private token: string | null = null;

	constructor(
		private container: HTMLElement,
		private mdSourceFilePath: string
	) {}

	/**
	 * Listen to specific event types from the child iframe with type safety
	 */
	onEventType<T extends ChildEvents["type"]>(
		eventType: T,
		cb: (e: Extract<ChildEvents, { type: T }>) => void
	) {
		if (!this.typedListeners.has(eventType)) {
			this.typedListeners.set(eventType, new Set());
		}
		const typedCb = cb as (e: ChildEvents) => void;
		this.typedListeners.get(eventType)!.add(typedCb);
		return () => {
			const listeners = this.typedListeners.get(eventType);
			if (listeners) {
				listeners.delete(typedCb);
				if (listeners.size === 0) {
					this.typedListeners.delete(eventType);
				}
			}
		};
	}

	private makeToken() {
		try {
			return uuidv4();
		} catch {
			return `${Math.random()}-${Date.now()}`;
		}
	}

	private buildParentAPI(): ParentAPI {
		return {
			getBlobUrlMap: () => (window as any).BLOB_URL_MAP,

			isAndroidApp: () => Platform.isAndroidApp,

			handleEvent: (evt) => {
				const ls = this.typedListeners.get(evt.type);
				if (ls) ls.forEach((l) => l(evt));
			},

			getMarkdownSourceFilePath: () => this.mdSourceFilePath,

			getOrigin: () => {
				return window.location.origin;
			},

			getMathJaxConfig: () => {
				return (window as any).MathJax?.config || {};
			},

			getColorScheme: () => {
				return getComputedStyle(document.body)
					.colorScheme as ColorScheme;
			},

			getStyleSheets: () => {
				return document.styleSheets;
			},

			createAnnotationEditor: async (
				containerId: string,
				options: Partial<MarkdownEditorProps>
			) => {
				const container =
					this.iframe!.contentDocument!.getElementById(containerId);
				if (!container) {
					throw new Error(`Container not found: ${containerId}`);
				}
				const editor = createEmbeddableMarkdownEditor(
					(window as any).app,
					container as HTMLElement,
					{
						...options,
						onBlur: (editor) => {
							editor.activeCM.dispatch({
								effects: EditorView.scrollIntoView(0, {
									y: "start",
								}),
							});
						},
					}
				);
				this.editorList.push(editor);
				return true;
			},
		};
	}

	async connect() {
		if (this.state !== "idle" && this.state !== "disposed") return;
		this.state = "connecting";

		// Create iframe
		this.iframe = document.createElement("iframe");
		this.iframe.id = "zotero-reader-iframe";
		this.iframe.style.cssText = "width:100%;height:100%;border:none;";

		if (Platform.isAndroidApp) {
			const srcdoc = await fetch(
				(window as any).BLOB_URL_MAP["reader.html"]
			).then((res) => res.text());
			this.iframe.srcdoc = srcdoc;
		} else {
			this.iframe.src = this.src;
		}

		// Sandbox as before (same-origin required for direct access)
		this.iframe.sandbox.add("allow-scripts");
		this.iframe.sandbox.add("allow-same-origin");
		this.iframe.sandbox.add("allow-forms");

		this.iframe.onload = () => {
			// Only handle unexpected reloads when we're in a stable state
			if (this.state === "ready" && this._readerOpts) {
				// It was loaded before, but it was loaded again somehow
				// We need to reconnect but avoid infinite loop
				console.warn(
					"Iframe reloaded unexpectedly, triggering reconnection"
				);
				// Use setTimeout to avoid potential stack overflow
				setTimeout(() => this.reconnect(), 0);
			}
		};

		// Attach first to get a contentWindow
		this.container.replaceChildren(this.iframe);

		const messenger = new WindowMessenger({
			remoteWindow: this.iframe.contentWindow!,
			allowedOrigins: ["*"],
		});

		const conn = connect({
			messenger,
			methods: {
				shakehand: async () => {
					if (this.iframe?.contentWindow) {
						this.token = this.makeToken();
						const parentAPI = this.buildParentAPI();

						const register = async (
							childAPI: ChildAPI,
							t: string
						) => {
							if (t !== this.token)
								throw new Error("Bridge token mismatch");
							this.child = childAPI;
							this.state = "ready";

							// Drain queued calls
							const tasks = [...this.queue];
							this.queue.length = 0;
							for (const t of tasks) await t();

							return { ok: true };
						};

						const getBridge: DirectBridgeBootstrap = () => ({
							token: this.token!,
							parent: parentAPI,
							register,
						});

						// Make it non-enumerable & configurable (child can delete after use)
						Object.defineProperty(
							this.iframe.contentWindow as any,
							"__OBSIDIAN_BRIDGE__",
							{
								value: getBridge,
								enumerable: false,
								writable: false,
								configurable: true,
							}
						);
					}
				},
			},
		});

		// Wait for child to setup penpal connection
		const remotePromise = conn.promise;
		await Promise.race([
			remotePromise,
			new Promise<never>((_, rej) =>
				setTimeout(
					() => rej(new Error("Child connect timeout")),
					this.connectTimeoutMs
				)
			),
		]);

		// Wait until the child calls register() (state becomes "ready") or timeout
		await Promise.race([
			new Promise<void>((resolve) => {
				const tick = (): void => {
					if (this.state === "ready") {
						resolve();
					} else {
						setTimeout(tick, 10);
					}
				};
				tick();
			}),
			new Promise<never>((_, rej) =>
				setTimeout(
					() => rej(new Error("Child connect timeout")),
					this.connectTimeoutMs
				)
			),
		]);

		if (this._readerOpts) {
			await this.child!.initReader(this._readerOpts);
		}
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
		this._readerOpts = opts;
		return this.enqueueOrRun(async () => {
			await this.child!.initReader(opts);
		});
	}

	setColorScheme(colorScheme: ColorScheme) {
		return this.enqueueOrRun(async () => {
			await this.child!.setColorScheme(colorScheme);
		});
	}

	navigate(navigationInfo: any) {
		return this.enqueueOrRun(async () => {
			await this.child!.navigate(navigationInfo);
		});
	}

	async dispose(clearListeners = true) {
		if (this.state === "disposed") return;
		this.editorList.forEach((editor) => editor.onunload());
		this.state = "disposing";
		try {
			if (this.iframe?.contentWindow) {
				delete (this.iframe.contentWindow as any).__ZREADER_BRIDGE__;
			}
		} catch {}
		this.child = undefined;
		this.iframe?.remove();
		this.iframe = null;
		if (clearListeners) this.typedListeners.clear();
		this.state = "disposed";
	}

	async reconnect() {
		await this.dispose(false);
		return this.connect();
	}
}
