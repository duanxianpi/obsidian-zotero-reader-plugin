/**
 * Annotation Manager
 *
 * High-level interface for managing Zotero annotations in Obsidian files
 * This class integrates with Obsidian's file system and provides convenient methods
 * for working with annotation blocks in markdown files.
 */

import {
	TFile,
	Vault,
	MetadataCache,
	getFrontMatterInfo,
	parseYaml,
} from "obsidian";
import { AnnotationParser, OzrpAnnoMarks } from "../parser/annotation-parser";
import { ParsedAnnotation, ZoteroAnnotation } from "../types/zotero-reader";
import * as nunjucks from "nunjucks";
import { DEFAULT_SETTINGS } from "../main";

export interface AnnotationInsertOptions {
	insertAt?: "annotation-blocks" | "end"; // default: end
}

export interface AnnotationUpdatePatch {
	json?: ZoteroAnnotation;
}

const ANNOTATION_COLORS = new Map<string, string>([
	["#ffd400", "yellow"],
	["#ff6666", "red"],
	["#5fb236", "green"],
	["#2ea8e5", "blue"],
	["#a28ae5", "purple"],
	["#e56eee", "magenta"],
	["#f19837", "orange"],
	["#aaaaaa", "gray"],
]);

export class AnnotationManager {
	private file: TFile;
	private vault: Vault;
	private source: string;
	private _annotationMap: Map<string, ParsedAnnotation>;
	private _operationLock: Promise<void> = Promise.resolve();
	private nunjucksEnv: nunjucks.Environment;
	private customAnnotationTemplate?: string;

	public get annotationMap(): Map<string, ParsedAnnotation> {
		return this._annotationMap;
	}

	private constructor(
		vault: Vault,
		file: TFile,
		content: string,
		source: string,
		customAnnotationTemplate?: string
	) {
		this.file = file;
		this.vault = vault;
		this.source = source;
		this._annotationMap = AnnotationParser.parseWithRanges(content);
		this.customAnnotationTemplate = customAnnotationTemplate;

		// Configure Nunjucks environment for string templates
		this.nunjucksEnv = new nunjucks.Environment(undefined, {
			autoescape: false,
		});
	}

	/**
	 * Create a new AnnotationManager
	 */
	static async create(
		vault: Vault,
		file: TFile,
		customAnnotationTemplate?: string
	): Promise<AnnotationManager> {
		const content = await vault.read(file);
		const info = getFrontMatterInfo(content);

		// turn the YAML string into a JS object
		const fileFrontmatter = parseYaml(info.frontmatter) as Record<
			string,
			unknown
		>;

		const source = (fileFrontmatter["source"] as string) || file.basename;

		return new AnnotationManager(
			vault,
			file,
			content,
			source,
			customAnnotationTemplate
		);
	}

	/**
	 * Get the annotation block template
	 */
	private getAnnotationBlockTemplate(): string {
		if (
			this.customAnnotationTemplate &&
			this.customAnnotationTemplate.trim()
		) {
			return this.customAnnotationTemplate;
		}

		// Default template
		return DEFAULT_SETTINGS.annotationBlockTemplate;
	}

	/**
	 * Execute an operation under lock to prevent race conditions
	 */
	private async withLock<T>(operation: () => Promise<T>): Promise<T> {
		const currentLock = this._operationLock;
		let resolveLock: () => void;
		this._operationLock = new Promise((resolve) => {
			resolveLock = resolve;
		});

		try {
			await currentLock;
			return await operation();
		} finally {
			resolveLock!();
		}
	}

	/**
	 * Insert a new annotation block into a file.
	 * Returns the id of the new block.
	 */
	async addAnnotation(
		data: { json: ZoteroAnnotation },
		options: AnnotationInsertOptions = {}
	): Promise<boolean> {
		return this.withLock(async () => {
			const content = await this.vault.read(this.file);

			const section = this.buildAnnotationSection(data.json);

			const updated = this.insertByStrategy(
				content,
				section,
				options.insertAt ?? "annotation-blocks"
			);
			await this.vault.modify(this.file, updated);
			this._annotationMap = AnnotationParser.parseWithRanges(updated);

			return true;
		});
	}

	/** Update an existing annotation block by id */
	async updateAnnotation(
		id: string,
		patch: AnnotationUpdatePatch
	): Promise<boolean> {
		return this.withLock(async () => {
			const content = await this.vault.read(this.file);
			this._annotationMap = AnnotationParser.parseWithRanges(content);
			const target = this.annotationMap.get(id);
			if (!target) return false;

			if (!patch.json) return false; // nothing to do

			const replacement = this.buildAnnotationSection(patch.json);

			const updated =
				content.slice(0, target.range.start) +
				replacement +
				content.slice(target.range.end);

			await this.vault.modify(this.file, updated);
			this._annotationMap = AnnotationParser.parseWithRanges(updated);

			return true;
		});
	}

	/** Update all annotations to the latest template */
	async updateAllAnnotationsToLatestTemplate(): Promise<number> {
		const content = await this.vault.read(this.file);
		this._annotationMap = AnnotationParser.parseWithRanges(content);
		const annotations = this.annotationMap;
		let updatedCount = 0;
		for (const [id, annotation] of annotations.entries()) {
			const success = await this.updateAnnotation(id, {
				json: {
					...annotation.json,
					text: annotation.text,
					comment: annotation.comment,
				},
			});
			if (success) {
				updatedCount++;
			}
		}
		return updatedCount;
	}

	/** Remove an annotation block by id */
	async removeAnnotation(id: string): Promise<boolean> {
		return this.withLock(async () => {
			const content = await this.vault.read(this.file);
			this._annotationMap = AnnotationParser.parseWithRanges(content);

			const target = this.annotationMap.get(id);
			if (!target) return false;

			const before = content.slice(0, target.range.start - 1);
			const after = content.slice(target.range.end);

			// Remove extra leading newlines to avoid excessive blank lines
			const beforeTrimmed = before.replace(/(\r?\n)+$/g, "\n");
			const afterTrimmed = after.replace(/^(\r?\n)+/g, "\n");

			const newContent = beforeTrimmed + afterTrimmed;

			await this.vault.modify(this.file, newContent);
			this._annotationMap = AnnotationParser.parseWithRanges(newContent);
			return true;
		});
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
		return this.withLock(async () => {
			const content = await this.vault.read(this.file);
			return AnnotationParser.validateFileAnnotations(content);
		});
	}

	/**
	 * Refresh the annotation map from the current file content
	 * This method is thread-safe and updates the internal map
	 */
	async refreshAnnotationMap(): Promise<void> {
		return this.withLock(async () => {
			const content = await this.vault.read(this.file);
			this._annotationMap = AnnotationParser.parseWithRanges(content);
		});
	}

	/** Build a canonical annotation section string (BEGIN..END) */
	private buildAnnotationSection(json: ZoteroAnnotation): string {
		// Prepare source text
		let sourceText = this.file.basename;

		const trimmedSource = this.source.trim();
		sourceText = trimmedSource.replace(/^\[\[|\]\]$/g, "");
		sourceText = sourceText.split("/").pop() || sourceText;

		// Prepare template data
		const pageLabel = json.pageLabel || "";
		const displayText =
			sourceText + (pageLabel ? `, page ${pageLabel}` : "");
		const color = ANNOTATION_COLORS.get(json.color) || "yellow";
		const navLink = encodeURIComponent(
			JSON.stringify({ annotationID: json.id })
		);

		// Template context
		const templateContext = {
			beginMarker: OzrpAnnoMarks.BEGIN.replace(
				"{json}",
				JSON.stringify({ ...json, text: "", comment: "" })
			),
			endMarker: OzrpAnnoMarks.END,
			quoteBeginMarker: OzrpAnnoMarks.Q_BEGIN,
			quoteEndMarker: OzrpAnnoMarks.Q_END,
			commentBeginMarker: OzrpAnnoMarks.C_BEGIN,
			commentEndMarker: OzrpAnnoMarks.C_END,
			type: json.type,
			color,
			displayText,
			encodedFilePath: encodeURIComponent(this.file.path),
			navLink,
			quote: json.text || "",
			comment: json.comment || "",
			id: json.id,
		};

		// Render using Nunjucks
		const template = this.getAnnotationBlockTemplate();
		return this.nunjucksEnv.renderString(template, templateContext).trim();
	}

	/** Internal: choose insertion point strategy */
	private insertByStrategy(
		content: string,
		section: string,
		where: NonNullable<AnnotationInsertOptions["insertAt"]>
	): string {
		switch (where) {
			case "annotation-blocks":
				return this.insertInAnnotationBlocks(content, section);
			case "end":
			default: {
				const contentTrimmed = content.replace(/(\r?\n)+$/g, "");
				return contentTrimmed + "\n\n" + section;
			}
		}
	}

	/** Insert annotation within annotation blocks section */
	private insertInAnnotationBlocks(content: string, section: string): string {
		// First, try to find the BLOCKS_END marker to insert before it
		const blocksEndIndex = content.indexOf(OzrpAnnoMarks.BLOCKS_END);
		if (blocksEndIndex !== -1) {
			// Split content at the marker position
			const before = content.slice(0, blocksEndIndex);
			const after = content.slice(blocksEndIndex);

			const beforeTrimmed = before.replace(/(\r?\n)+$/g, "");
			const afterTrimmed = after.replace(/^(\r?\n)+/g, "");

			const newContent =
				beforeTrimmed + "\n\n" + section + "\n\n" + afterTrimmed;

			return newContent;
		}
		// If no BLOCKS_END marker, append at the end with proper separation
		const contentTrimmed = content.replace(/(\r?\n)+$/g, "");
		return contentTrimmed + "\n\n" + section;
	}
}
