/**
 * Annotation Manager
 * 
 * High-level interface for managing Zotero annotations in Obsidian files
 * This class integrates with Obsidian's file system and provides convenient methods
 * for working with annotation blocks in markdown files.
 */

import { TFile, Vault, MetadataCache } from 'obsidian';
import { AnnotationParser } from 'src/parser/annotation-parser';
import { ParsedAnnotationBlock, ZoteroAnnotation } from 'src/types/zotero-reader';

export interface AnnotationImportOptions {
	insertAt?: 'beginning' | 'end' | 'after-frontmatter';
	addTimestamp?: boolean;
	tagPrefix?: string;
}

export class AnnotationManager {
	private vault: Vault;
	private metadataCache: MetadataCache;

	constructor(vault: Vault, metadataCache: MetadataCache) {
		this.vault = vault;
		this.metadataCache = metadataCache;
	}

	/**
	 * Get all annotations from a specific file
	 */
	async getAnnotationsFromFile(file: TFile): Promise<ParsedAnnotationBlock[]> {
		const content = await this.vault.read(file);
		return AnnotationParser.parseMarkdownFile(content);
	}

	/**
	 * Add a new annotation to a file
	 */
	async addAnnotationToFile(
		file: TFile,
		annotation: Partial<ParsedAnnotationBlock>,
		options: AnnotationImportOptions = {}
	): Promise<void> {
		const content = await this.vault.read(file);
		
		// Ensure the annotation has an ID
		if (!annotation.metadata?.id) {
			annotation.metadata = {
				...annotation.metadata,
			} as ZoteroAnnotation;
		}

		// Add timestamp if requested
		if (options.addTimestamp) {
			const timestamp = new Date().toISOString().split('T')[0];
			annotation.comments = annotation.comments 
				? `${annotation.comments}\n\nAdded: ${timestamp}`
				: `Added: ${timestamp}`;
		}

		// Add tag prefix if specified
		if (options.tagPrefix && annotation.metadata) {
			const existingTags = annotation.metadata.tags || [];
			annotation.metadata.tags = existingTags.map(tag => 
				tag.startsWith(options.tagPrefix!) ? tag : `${options.tagPrefix}${tag}`
			);
		}

		let newContent: string;

		switch (options.insertAt) {
			case 'beginning':
				newContent = AnnotationParser.createAnnotationBlock(annotation) + '\n\n' + content;
				break;
			case 'after-frontmatter':
				newContent = this.insertAfterFrontmatter(content, annotation);
				break;
			case 'end':
			default:
				newContent = AnnotationParser.insertAnnotationAtEnd(content, annotation);
				break;
		}

		await this.vault.modify(file, newContent);
	}

	/**
	 * Update an existing annotation in a file
	 */
	async updateAnnotationInFile(
		file: TFile,
		annotationId: string,
		updates: Partial<ParsedAnnotationBlock>
	): Promise<void> {
		const content = await this.vault.read(file);
		const newContent = AnnotationParser.replaceAnnotation(content, annotationId, updates);
		await this.vault.modify(file, newContent);
	}

	/**
	 * Remove an annotation from a file
	 */
	async removeAnnotationFromFile(file: TFile, annotationId: string): Promise<void> {
		const content = await this.vault.read(file);
		const newContent = AnnotationParser.removeAnnotation(content, annotationId);
		await this.vault.modify(file, newContent);
	}

	/**
	 * Validate all annotation blocks in a file
	 */
	async validateFileAnnotations(file: TFile) {
		const content = await this.vault.read(file);
		return AnnotationParser.validateAnnotationBlocks(content);
	}

	/**
	 * Insert annotation after frontmatter
	 */
	private insertAfterFrontmatter(content: string, annotation: Partial<ParsedAnnotationBlock>): string {
		const lines = content.split('\n');
		let insertIndex = 0;

		// Check if file has frontmatter
		if (lines[0] === '---') {
			// Find the end of frontmatter
			for (let i = 1; i < lines.length; i++) {
				if (lines[i] === '---') {
					insertIndex = i + 1;
					break;
				}
			}
		}

		const blockContent = AnnotationParser.createAnnotationBlock(annotation);
		const newLines = [
			...lines.slice(0, insertIndex),
			'',
			...blockContent.split('\n'),
			'',
			...lines.slice(insertIndex)
		];

		return newLines.join('\n');
	}
}