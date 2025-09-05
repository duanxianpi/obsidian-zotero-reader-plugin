/**
 * Annotation Manager
 *
 * High-level interface for managing Zotero annotations in Obsidian files
 * This class integrates with Obsidian's file system and provides convenient methods
 * for working with annotation blocks in markdown files.
 */

import { TFile, Vault, MetadataCache } from "obsidian";
import {
	AnnotationParser,
	computeAnnotationId,
	OzrpAnnoMarks,
} from "../parser/annotation-parser";
import { ParsedAnnotation, ZoteroAnnotation } from "../types/zotero-reader";

export interface AnnotationInsertOptions {
	insertAt?: "beginning" | "end" | "after-frontmatter"; // default: end
	addTimestamp?: boolean; // append timestamp to comment block
	tagPrefix?: string; // e.g. "#zotero/anno"
	header?: string; // optional header/callout line content WITHOUT leading ">" (we add quoting)
}

export interface AnnotationUpdatePatch {
	text?: string;
	comment?: string;
	json?: ZoteroAnnotation;
	header?: string | null; // set to null to remove header, string to set, omit to keep
}

/** Tools */
const NL = "\n";
const ensureTrailingNL = (s: string) => (s.endsWith("\n") ? s : s + "\n");

export class AnnotationManager {
	private vault: Vault;
	private metadataCache: MetadataCache;

	constructor(vault: Vault, metadataCache: MetadataCache) {
		this.vault = vault;
		this.metadataCache = metadataCache;
	}

	/** Read + parse all annotations from a file (with ranges) */
	async getParsedAnnotations(file: TFile): Promise<ParsedAnnotation[]> {
		const content = await this.vault.read(file);
		return AnnotationParser.parseWithRanges(content);
	}

	/**
	 * Insert a new annotation block into a file.
	 * Returns the id of the new block.
	 */
	async addAnnotationToFile(
		file: TFile,
		data: { json: ZoteroAnnotation; text: string; comment: string },
		options: AnnotationInsertOptions = {}
	): Promise<string> {
		const content = await this.vault.read(file);

		const id = computeAnnotationId(data.json, data.text, data.comment);

		const section = this.buildAnnotationSection({
			header: options.header,
			text: data.text,
			comment: data.comment,
			json: data.json,
			addTimestamp: options.addTimestamp,
			tagPrefix: options.tagPrefix,
		});

		const updated = this.insertByStrategy(
			content,
			section,
			options.insertAt ?? "end"
		);
		await this.vault.modify(file, updated);
		return id;
	}

	/** Update an existing annotation block by id */
	async updateAnnotationInFile(
		file: TFile,
		id: string,
		patch: AnnotationUpdatePatch
	): Promise<boolean> {
		const content = await this.vault.read(file);
		const parsed = AnnotationParser.parseWithRanges(content);
		const target = parsed.find((p) => p.id === id);
		if (!target) return false;

		// Build a new section using existing values merged with patch
		const newHeader =
			patch.header === undefined
				? target.header
				: patch.header || undefined;
		const newText = patch.text ?? target.text;
		const newComment = patch.comment ?? target.comment;
		const newJson = patch.json
			? { ...target.json, ...patch.json }
			: target.json;

		const replacement = this.buildAnnotationSection({
			header: newHeader,
			text: newText,
			comment: newComment,
			json: newJson,
		});

		const updated =
			content.slice(0, target.range.start) +
			replacement +
			content.slice(target.range.end);

		await this.vault.modify(file, updated);
		return true;
	}

	/** Remove an annotation block by id */
	async removeAnnotationFromFile(file: TFile, id: string): Promise<boolean> {
		const content = await this.vault.read(file);
		const parsed = AnnotationParser.parseWithRanges(content);
		const target = parsed.find((p) => p.id === id);
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

		await this.vault.modify(file, beforeClean + afterClean);
		return true;
	}

	/** Validate all annotation blocks and return issues */
	async validateFileAnnotations(file: TFile): Promise<
		Array<{
			id?: string;
			range: { start: number; end: number };
			problem: string;
			hint?: string;
		}>
	> {
		const content = await this.vault.read(file);
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

	/** Build a canonical annotation section string (BEGIN..END) */
	private buildAnnotationSection(opts: {
		header?: string | null;
		text: string;
		comment: string;
		json: Record<string, any>;
		addTimestamp?: boolean;
		tagPrefix?: string;
	}): string {
		const pieces: string[] = [];
		pieces.push(OzrpAnnoMarks.BEGIN);

		if (opts.header && opts.header.trim()) {
			pieces.push(this.asBlockquote(opts.header.trim()));
			pieces.push("> ");
		}

		// Quote
		pieces.push("> " + OzrpAnnoMarks.Q_BEGIN);
		const q = ensureTrailingNL(opts.text || "");
		pieces.push(this.asBlockquote(q));
		pieces.push("> " + OzrpAnnoMarks.Q_END);
		pieces.push("> ");

		// Comment (optional but we always include the block for stability)
		pieces.push("> " + OzrpAnnoMarks.C_BEGIN);
		let comment = opts.comment || "";
		const tags = opts.tagPrefix ? ` ${opts.tagPrefix}` : "";
		if (opts.addTimestamp) {
			const iso = new Date().toISOString();
			comment = comment ? `${comment}\n@${iso}${tags}` : `@${iso}${tags}`;
		} else if (tags) {
			comment = comment ? `${comment}\n${tags}` : `${tags}`;
		}
		pieces.push(this.asBlockquote(ensureTrailingNL(comment)));
		pieces.push("> " + OzrpAnnoMarks.C_END);
		pieces.push("");

		// JSON inline
		const jsonInline = `${OzrpAnnoMarks.J_INLINE_BEGIN} ${JSON.stringify(
			opts.json
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
