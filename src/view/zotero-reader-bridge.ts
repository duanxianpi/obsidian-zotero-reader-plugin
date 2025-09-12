import { WindowMessenger, connect, Connection, RemoteProxy } from "penpal";
import type {
	ChildApi,
	ParentApi,
	CreateReaderOptions,
	ColorScheme,
	ChildEvents,
} from "../types/zotero-reader";
import {
	createEmbeddableMarkdownEditor,
	EmbeddableMarkdownEditor,
	MarkdownEditorProps,
} from "../editor/markdownEditor";
import { EditorView, keymap, placeholder, ViewUpdate } from "@codemirror/view";
import { App } from "obsidian";

type BridgeState =
	| "idle"
	| "connecting"
	| "ready"
	| "disposing"
	| "disposed";

export class IframeReaderBridge {
	private iframe: HTMLIFrameElement | null = null;
	private conn?: Connection<ChildApi>;
	private remote?: RemoteProxy<ChildApi>;
	private state: BridgeState = "idle";
	private queue: (() => Promise<void>)[] = [];
	private typedListeners = new Map<
		ChildEvents["type"],
		Set<(e: ChildEvents) => void>
	>();
	private connectTimeoutMs = 8000;
	private editorList: EmbeddableMarkdownEditor[] = [];
	private _readerOpts: CreateReaderOptions | undefined;

	private src = (window as any).BLOB_URL_MAP["reader.html"];
	private allowedOrigins: string[] = ["*"];

	constructor(
		private container: HTMLElement,
		private mdSourceFilePath: string
	) {}

	/**
	 * Listen to specific event types from the child iframe with type safety
	 * @param eventType The specific event type to listen for
	 * @param cb Callback function that receives only events of the specified type
	 * @returns Unsubscribe function
	 *
	 * @example
	 * // Listen only to error events
	 * bridge.onEventType("error", (evt) => {
	 *   console.error(`${evt.code}: ${evt.message}`);
	 * });
	 *
	 * // Listen only to link opening events
	 * bridge.onEventType("openLink", (evt) => {
	 *   window.open(evt.url, '_blank');
	 * });
	 *
	 * // Listen to sidebar toggle events
	 * bridge.onEventType("sidebarToggled", (evt) => {
	 *   console.log("Sidebar is now:", evt.open ? "open" : "closed");
	 * });
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

	async connect() {
		if (this.state !== "idle" && this.state !== "disposed") return;
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

		this.iframe.onload = () => {
			// Only handle unexpected reloads when we're in a stable state
			if (this.state === "ready" && this._readerOpts) {
				// It was loaded before, but it was loaded again somehow
				// We need to reconnect but avoid infinite loop
				console.warn("Iframe reloaded unexpectedly, triggering reconnection");
				// Use setTimeout to avoid potential stack overflow
				setTimeout(() => this.reconnect(), 0);
			}
		};


		// Parent API exposed to child (event channel)
		const parentApi: ParentApi = {
			handleEvent: (evt) => {
				// Notify typed listeners for this specific event type
				const typedListeners = this.typedListeners.get(evt.type);
				if (typedListeners) {
					typedListeners.forEach((l) => l(evt));
				}
			},
			createAnnotationEditor: async (
				containerId: string,
				annotationId: string,
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
						onChange: (update: ViewUpdate) => {
							this.remote?.updateAnnotation({
								id: annotationId,
								comment: update.state.doc.toString(),
							});
						},
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
		console.log("Child proxy connected", this.remote);

		// If this is a reconnection and we have reader options, re-initialize the reader
		if (this._readerOpts) {
			await this.remote.initReader(this.mdSourceFilePath, this._readerOpts);
		}

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
		this._readerOpts = opts;
		return this.enqueueOrRun(async () => {
			await this.remote!.initReader(this.mdSourceFilePath, opts);
		});
	}

	setColorScheme(colorScheme: ColorScheme) {
		return this.enqueueOrRun(async () => {
			await this.remote!.setColorScheme(colorScheme);
		});
	}

	navigate(navigationInfo: any) {
		return this.enqueueOrRun(async () => {
			await this.remote!.navigate(navigationInfo);
		});
	}

	async dispose(clearListeners = true) {
		if (!this.conn || this.state === "disposed") return;
		this.editorList.forEach((editor) => editor.onunload());
		this.state = "disposing";
		this.conn!.destroy();
		this.conn = undefined;
		this.remote = undefined;
		this.iframe?.remove();
		this.iframe = null;
		if (clearListeners) {
			this.typedListeners.clear();
		}
		this.state = "disposed";
	}

	async reconnect() {
		await this.dispose(false); // Don't clear listeners during reconnection
		return this.connect();
	}
}
