/**
 * Annotation Manager
 *
 * High-level interface for managing Zotero annotations in Obsidian files
 * This class integrates with Obsidian's file system and provides convenient methods
 * for working with annotation blocks in markdown files.
 */

import { TFile, Vault, MetadataCache } from "obsidian";
import { AnnotationParser, OzrpAnnoMarks } from "../parser/annotation-parser";
import { ParsedAnnotation, ZoteroAnnotation } from "../types/zotero-reader";

export interface AnnotationInsertOptions {
	insertAt?: "beginning" | "end" | "after-frontmatter"; // default: end
}

export interface AnnotationUpdatePatch {
	json?: ZoteroAnnotation;
}

/** Tools */
const NL = "\n";
const ensureTrailingNL = (s: string) => (s.endsWith("\n") ? s : s + "\n");

export class AnnotationManager {
	private file: TFile;
	private vault: Vault;
	private metadataCache: MetadataCache;

	private _annotationMap: Map<string, ParsedAnnotation>;
	public get annotationMap(): Map<string, ParsedAnnotation> {
		return this._annotationMap;
	}
	constructor(
		vault: Vault,
		metadataCache: MetadataCache,
		file: TFile,
		content: string
	) {
		this.file = file;
		this.vault = vault;
		this.metadataCache = metadataCache;

		this._annotationMap = AnnotationParser.parseWithRanges(content);
	}

	/**
	 * Insert a new annotation block into a file.
	 * Returns the id of the new block.
	 */
	async addAnnotation(
		data: { json: ZoteroAnnotation },
		options: AnnotationInsertOptions = {}
	): Promise<boolean> {
		const content = await this.vault.read(this.file);

		const section = this.buildAnnotationSection(data.json);

		const updated = this.insertByStrategy(
			content,
			section,
			options.insertAt ?? "end"
		);
		await this.vault.modify(this.file, updated);
		this._annotationMap = AnnotationParser.parseWithRanges(updated);

		return true;
	}

	/** Update an existing annotation block by id */
	async updateAnnotation(
		id: string,
		patch: AnnotationUpdatePatch
	): Promise<boolean> {
		const content = await this.vault.read(this.file);
		this._annotationMap = AnnotationParser.parseWithRanges(content);
		const target = this._annotationMap.get(id);
		if (!target) return false;

		if (!patch.json) return false; // nothing to do

		const replacement = this.buildAnnotationSection(patch.json);

		const updated =
			content.slice(0, target.range.start) +
			replacement +
			content.slice(target.range.end);

		await this.vault.modify(this.file, updated);
		this._annotationMap = AnnotationParser.parseWithRanges(content);

		return true;
	}

	/** Remove an annotation block by id */
	async removeAnnotation(id: string): Promise<boolean> {
		const content = await this.vault.read(this.file);
		this._annotationMap = AnnotationParser.parseWithRanges(content);

		const target = this.annotationMap.get(id);
		if (!target) return false;

		const before = content.slice(0, target.range.start);
		const after = content.slice(target.range.end);

		// Clean up leading/trailing blank lines to avoid double gaps
		const beforeClean = before.replace(/[\t ]*\n?[\t ]*$/, (m) =>
			m.includes("\n") ? "\n" : ""
		);
		const afterClean = after.replace(/^[\t ]*\n?/, (m) =>
			m.includes("\n") ? "\n" : ""
		);

		await this.vault.modify(this.file, beforeClean + afterClean);
		this._annotationMap = AnnotationParser.parseWithRanges(
			beforeClean + afterClean
		);

		return true;
	}

	/** Validate all annotation blocks and return issues */
	async validateFileAnnotations(): Promise<
		Array<{
			id?: string;
			range: { start: number; end: number };
			problem: string;
			hint?: string;
		}>
	> {
		const content = await this.vault.read(this.file);
		return AnnotationParser.validateFileAnnotations(content);
	}

	/** Add "> " prefix to each non-empty line. */
	private asBlockquote(text: string): string {
		return text
			.replace(/\s+$/, "")
			.split(/\r?\n/)
			.map((l) => (l.length ? "> " + l : ">"))
			.join("\n");
	}

	/** Add "> " prefix to each non-empty line.
	 *  For quote blocks, use "> > " for the first line.
	 */
	private asQuoteBlockquote(text: string): string {
		return text
			.replace(/\s+$/, "")
			.split(/\r?\n/)
			.map((l, idx) =>
				l.length ? (idx === 0 ? "> > " : "> ") + l : "> >"
			)
			.join("\n");
	}

	/** Build a canonical annotation section string (BEGIN..END) */
	private buildAnnotationSection(json: ZoteroAnnotation): string {
		const pieces: string[] = [];
		pieces.push(OzrpAnnoMarks.BEGIN);

		// if (header && header.trim()) {
		// 	pieces.push(this.asBlockquote(header.trim()));
		// 	pieces.push("> ");
		// }

		// Quote
		pieces.push("> " + OzrpAnnoMarks.Q_BEGIN);
		const q = ensureTrailingNL(json.text || "");
		pieces.push(this.asQuoteBlockquote(q));
		pieces.push("> " + OzrpAnnoMarks.Q_END);
		pieces.push("> ");

		// Comment (optional but we always include the block for stability)
		pieces.push("> " + OzrpAnnoMarks.C_BEGIN);
		const comment = json.comment || "";
		pieces.push(this.asBlockquote(ensureTrailingNL(comment)));
		pieces.push("> " + OzrpAnnoMarks.C_END + ` ^${json.id}`);
		pieces.push("");

		// JSON inline
		const jsonInline = `${OzrpAnnoMarks.J_INLINE_BEGIN} ${JSON.stringify(
			json
		)} ${OzrpAnnoMarks.J_INLINE_END}`;
		pieces.push(jsonInline);

		pieces.push(OzrpAnnoMarks.END);

		return pieces.join(NL) + NL; // always end with NL
	}

	/** Internal: choose insertion point strategy */
	private insertByStrategy(
		content: string,
		section: string,
		where: NonNullable<AnnotationInsertOptions["insertAt"]>
	): string {
		switch (where) {
			case "beginning":
				return (
					section +
					(content.startsWith("\n")
						? content
						: content
						? "\n" + content
						: "")
				);
			case "after-frontmatter":
				return this.insertAfterFrontmatter(content, section);
			case "end":
			default: {
				const needsGap =
					content.length > 0 && !content.endsWith("\n\n");
				const sep =
					content.length === 0 ? "" : needsGap ? "\n\n" : "\n";
				return content + sep + section;
			}
		}
	}

	/** Insert a section immediately after YAML frontmatter if present; else at top */
	private insertAfterFrontmatter(content: string, section: string): string {
		const fm = this.getFrontmatterRange(content);
		if (!fm) {
			return (
				section +
				(content.startsWith("\n")
					? content
					: content
					? "\n" + content
					: "")
			);
		}
		const before = content.slice(0, fm.end);
		const after = content.slice(fm.end);
		const sep = after.startsWith("\n\n") ? "\n" : "\n\n";
		return (
			before +
			sep +
			section +
			(after.startsWith("\n") ? "" : "\n") +
			after
		);
	}

	/** Return start/end indices of YAML frontmatter block, if the file starts with one */
	private getFrontmatterRange(
		content: string
	): { start: number; end: number } | null {
		if (!content.startsWith("---\n")) return null;
		// Find the closing --- at the start of a line
		const re = /^---\s*$[\s\S]*?^---\s*$\r?\n?/m;
		const m = re.exec(content);
		if (!m) return null;
		return { start: m.index, end: m.index + m[0].length };
	}
}
