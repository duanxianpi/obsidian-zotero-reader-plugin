import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder, Extension, RangeSet } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

export function OzrpAnnoCommentExtension(): Extension {
	const annoPrefix = /.*OZRP-ANNO.*/i;
	const annoJsonPrefix = /.*OZRP-ANNO-BEGIN.*/i;
	const commNodeStartName = /.*comment-start_formatting.*/i;
	const commNodeEndName = /.*comment-end_formatting.*/i;

	const markClassName = "cm-ozrp-anno-comment";
	const lineClassName = "cm-ozrp-anno-json-line";

	const markDeco = Decoration.mark({
		class: markClassName,
		attributes: { spellcheck: "false" },
	});

	const lineDeco = Decoration.line({
		class: lineClassName,
	});

	function build(view: EditorView): DecorationSet {
		const b = new RangeSetBuilder<Decoration>();
		const doc = view.state.doc;

		// Small state machine per visible window
		type Phase = "idle" | "sawStart" | "active";
		for (const vr of view.visibleRanges) {
			// expand to full lines to avoid missing a start/end that sits just offscreen
			const from = doc.lineAt(vr.from).from;
			const to = doc.lineAt(vr.to).to;

			let phase: Phase = "idle";
			let startSpan: { from: number; to: number } | null = null;
			syntaxTree(view.state).iterate({
				from,
				to,
				enter(node) {
					const name = node.name;

					if (phase === "idle") {
						if (commNodeStartName.test(name)) {
							startSpan = { from: node.from, to: node.to };
							phase = "sawStart"; // the *next* node decides
						}
						return;
					}

					if (phase === "sawStart") {
						// This is the node immediately after start. Check for ANNO: prefix.
						const text = doc.sliceString(node.from, node.to);
						if (annoPrefix.test(text)) {
							if (annoJsonPrefix.test(text)) {
								// If we see the JSON start marker,
								const line = doc.lineAt(node.from);

								b.add(line.from, line.from, lineDeco);
							}

							// Mark the start token and this node
							if (startSpan)
								b.add(startSpan.from, startSpan.to, markDeco);
							b.add(node.from, node.to, markDeco);
							phase = "active";
						} else {
							// Not an ANNO block -> discard and go idle
							phase = "idle";
							startSpan = null;
						}
						return;
					}

					// phase === "active": mark every node until we reach the end marker
					if (phase === "active") {
						b.add(node.from, node.to, markDeco);
						if (commNodeEndName.test(name)) {
							phase = "idle";
							startSpan = null;
						}
						return;
					}
				},
			});
		}
		return b.finish();
	}

	const plugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged) {
					this.decorations = build(u.view);
				}
			}
		},
		{ decorations: (v) => v.decorations }
	);

	return [plugin];
}
