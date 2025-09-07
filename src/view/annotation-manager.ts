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

		const replacement = this.buildAnnotationSection(patch.json, true);

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

		const NL = /\r\n/.test(content) ? "\r\n" : "\n";
		// Set to 2 to leave one *blank line* between blocks
		const MAX_NEWLINES_BETWEEN = 2;

		const before = content.slice(0, target.range.start);
		const after = content.slice(target.range.end);

		// Grab only *blank lines* at the join (whitespace + newline), not indentation before content.
		const leftBlank = before.match(/(?:[ \t]*\r?\n[ \t]*)+$/)?.[0] ?? "";
		const rightBlank = after.match(/^[ \t]*(?:\r?\n[ \t]*)+/)?.[0] ?? "";

		// Core text with boundary blanks stripped; also trim trailing spaces on the left side
		const beforeCore = (
			leftBlank
				? before.slice(0, before.length - leftBlank.length)
				: before
		).replace(/[ \t]+$/g, "");
		const afterCore = rightBlank ? after.slice(rightBlank.length) : after;

		const hadBoundaryBreak = leftBlank.length > 0 || rightBlank.length > 0;

		// Decide what to put between the cores
		let join = "";
		if (hadBoundaryBreak) {
			join = NL.repeat(MAX_NEWLINES_BETWEEN);
		} else {
			// Inline deletion: avoid `Helloworld`
			const leftChar = beforeCore.slice(-1);
			const rightChar = afterCore.slice(0, 1);
			if (
				leftChar &&
				rightChar &&
				/\S/.test(leftChar) &&
				/\S/.test(rightChar)
			) {
				join = " ";
			}
		}

		const newContent = beforeCore + join + afterCore;

		await this.vault.modify(this.file, newContent);
		this._annotationMap = AnnotationParser.parseWithRanges(newContent);
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
	private buildAnnotationSection(json: ZoteroAnnotation, isReplacementSection = false): string {
		const pieces: string[] = [];
		pieces.push(
			OzrpAnnoMarks.BEGIN.replace("{json}", JSON.stringify(json))
		);

		// if (header && header.trim()) {
		// 	pieces.push(this.asBlockquote(header.trim()));
		// 	pieces.push("> ");
		// }

		pieces.push(this.asBlockquote("[!Note] Annotation"));

		// Quote
		pieces.push("> " + OzrpAnnoMarks.Q_BEGIN);
		const q = ensureTrailingNL(json.text || "");
		pieces.push(this.asQuoteBlockquote(q));
		pieces.push("> " + OzrpAnnoMarks.Q_END);
		pieces.push("> ");

		// Comment (optional but we always include the block for stability)
		const comment = json.comment || "";
		// pieces.push("> " + OzrpAnnoMarks.C_BEGIN);
		pieces.push(this.asBlockquote(ensureTrailingNL(`${OzrpAnnoMarks.C_BEGIN} ${comment}`)));
		pieces.push("> " + OzrpAnnoMarks.C_END + ` ^${json.id}`);
		pieces.push("");

		pieces.push(OzrpAnnoMarks.END);

		// We only add new lines for non-replacement sections
		return pieces.join(NL) + (isReplacementSection ? "" : NL);
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
				const needsGap = content.length > 0 && !content.endsWith("\n");
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
