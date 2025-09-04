/**
 * Annotation Parser Module
 * 
 * This module provides functionality to parse, extract, modify, and manage
 * Zotero annotations in Obsidian markdown files with the following pattern:
 * 
 * > [!info] [[zotero://xxx.pdf | Here is a title, p.0]]
 * >> Here's a annotation text
 * >
 * > Comments
 * > %% { "type": "underline", "color": "#ff6666", ... }
 */

import { ParsedAnnotationBlock, ZoteroAnnotation } from "src/types/zotero-reader";

export class AnnotationParser {
	private static readonly CALLOUT_PATTERN = /^>\s*\[!info\]\s*\[\[([^|]+)\s*\|\s*([^,]+),\s*p\.(\d+)\]\]$/;
	private static readonly ANNOTATION_PATTERN = /^>>\s*(.+)$/;
	private static readonly COMMENT_PATTERN = /^>\s*(?!%)(.+)$/;
	private static readonly METADATA_PATTERN = /^>\s*%%\s*(\{.*\})\s*$/;
	private static readonly BLOCK_START_PATTERN = /^>\s*\[!info\]/;

	/**
	 * Parse a markdown file and extract all annotation blocks
	 */
	public static parseMarkdownFile(content: string): ParsedAnnotationBlock[] {
		const lines = content.split('\n');
		const blocks: ParsedAnnotationBlock[] = [];
		let currentBlock: Partial<ParsedAnnotationBlock> | null = null;
		let blockStartLine = -1;
		let inBlock = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];

			// Check if this is the start of a new annotation block
			if (this.BLOCK_START_PATTERN.test(line)) {
				// If we were already in a block, finalize it
				if (currentBlock && inBlock) {
					this.finalizeBlock(currentBlock, i - 1, blocks);
				}

				// Start new block
				const calloutMatch = line.match(this.CALLOUT_PATTERN);
				if (calloutMatch) {
					currentBlock = {
						zoteroLink: calloutMatch[1],
						title: calloutMatch[2].trim(),
						pageNumber: calloutMatch[3],
						annotationText: '',
						comments: '',
						rawText: line + '\n',
						startLine: i
					};
					blockStartLine = i;
					inBlock = true;
				}
				continue;
			}

			// If we're not in a block, skip
			if (!inBlock || !currentBlock) {
				continue;
			}

			// Add line to raw text
			currentBlock.rawText += line + '\n';

			// Parse annotation text (>>)
			const annotationMatch = line.match(this.ANNOTATION_PATTERN);
			if (annotationMatch) {
				if (currentBlock.annotationText) {
					currentBlock.annotationText += '\n' + annotationMatch[1];
				} else {
					currentBlock.annotationText = annotationMatch[1];
				}
				continue;
			}

			// Parse metadata (%%)
			const metadataMatch = line.match(this.METADATA_PATTERN);
			if (metadataMatch) {
				try {
					const metadata = JSON.parse(metadataMatch[1]);
					currentBlock.metadata = metadata;
					currentBlock.id = metadata.id;
				} catch (error) {
					console.warn('Failed to parse metadata JSON:', error);
				}
				continue;
			}

			// Parse comments (> but not >> or %%)
			const commentMatch = line.match(this.COMMENT_PATTERN);
			if (commentMatch) {
				if (currentBlock.comments) {
					currentBlock.comments += '\n' + commentMatch[1];
				} else {
					currentBlock.comments = commentMatch[1];
				}
				continue;
			}

			// Empty quote line or end of block
			if (line.trim() === '>' || line.trim() === '') {
				// Continue adding to raw text but don't process
				continue;
			}

			// If we hit a non-quote line, the block has ended
			if (!line.startsWith('>')) {
				this.finalizeBlock(currentBlock, i - 1, blocks);
				currentBlock = null;
				inBlock = false;
			}
		}

		// Finalize the last block if it exists
		if (currentBlock && inBlock) {
			this.finalizeBlock(currentBlock, lines.length - 1, blocks);
		}

		return blocks;
	}

	/**
	 * Find an annotation block by its ID
	 */
	public static findAnnotationById(content: string, id: string): ParsedAnnotationBlock | null {
		const blocks = this.parseMarkdownFile(content);
		return blocks.find(block => block.id === id) || null;
	}

	/**
	 * Extract all annotation IDs from a markdown file
	 */
	public static extractAnnotationIds(content: string): string[] {
		const blocks = this.parseMarkdownFile(content);
		return blocks.map(block => block.id).filter(id => id);
	}

	/**
	 * Replace an existing annotation block with new content
	 */
	public static replaceAnnotation(content: string, id: string, newAnnotation: Partial<ParsedAnnotationBlock>): string {
		const lines = content.split('\n');
		const existingBlock = this.findAnnotationById(content, id);
		
		if (!existingBlock) {
			throw new Error(`Annotation with ID ${id} not found`);
		}

		// Create the new block content
		const newBlockContent = this.createAnnotationBlock({
			...existingBlock,
			...newAnnotation
		});

		// Replace the lines
		const newLines = [
			...lines.slice(0, existingBlock.startLine),
			...newBlockContent.split('\n').filter(line => line !== ''),
			...lines.slice(existingBlock.endLine + 1)
		];

		return newLines.join('\n');
	}

	/**
	 * Insert a new annotation block at the end of the file
	 */
	public static insertAnnotationAtEnd(content: string, annotation: Partial<ParsedAnnotationBlock>): string {
		const blockContent = this.createAnnotationBlock(annotation);
		const separator = content.endsWith('\n') ? '\n' : '\n\n';
		return content + separator + blockContent;
	}

	/**
	 * Remove an annotation block by ID
	 */
	public static removeAnnotation(content: string, id: string): string {
		const lines = content.split('\n');
		const existingBlock = this.findAnnotationById(content, id);
		
		if (!existingBlock) {
			throw new Error(`Annotation with ID ${id} not found`);
		}

		// Remove the lines and any trailing empty lines
		let endLine = existingBlock.endLine;
		while (endLine + 1 < lines.length && lines[endLine + 1].trim() === '') {
			endLine++;
		}

		const newLines = [
			...lines.slice(0, existingBlock.startLine),
			...lines.slice(endLine + 1)
		];

		return newLines.join('\n');
	}

	/**
	 * Update the metadata of an existing annotation
	 */
	public static updateAnnotationMetadata(content: string, id: string, newMetadata: Partial<ZoteroAnnotation>): string {
		const existingBlock = this.findAnnotationById(content, id);
		
		if (!existingBlock) {
			throw new Error(`Annotation with ID ${id} not found`);
		}

		const updatedMetadata = {
			...existingBlock.metadata,
			...newMetadata,
			dateModified: new Date().toISOString()
		};

		return this.replaceAnnotation(content, id, {
			metadata: updatedMetadata
		});
	}

	/**
	 * Create annotation block text from a ParsedAnnotationBlock object
	 */
	public static createAnnotationBlock(annotation: Partial<ParsedAnnotationBlock>): string {
		const parts: string[] = [];

		// Create the callout line
		const zoteroLink = annotation.zoteroLink || 'zotero://unknown.pdf';
		const title = annotation.title || 'Unknown Title';
		const pageNumber = annotation.pageNumber || '0';
		parts.push(`> [!info] [[${zoteroLink} | ${title}, p.${pageNumber}]]`);

		// Add annotation text
		if (annotation.annotationText) {
			const annotationLines = annotation.annotationText.split('\n');
			annotationLines.forEach(line => {
				parts.push(`>> ${line}`);
			});
		}

		// Add empty line
		parts.push('>');

		// Add comments
		if (annotation.comments) {
			const commentLines = annotation.comments.split('\n');
			commentLines.forEach(line => {
				parts.push(`> ${line}`);
			});
		}

		// Add metadata
		if (annotation.metadata) {
			const metadataJson = JSON.stringify(annotation.metadata);
			parts.push(`> %% ${metadataJson}`);
		}

		return parts.join('\n');
	}

	/**
	 * Finalize a block and add it to the blocks array
	 */
	private static finalizeBlock(
		currentBlock: Partial<ParsedAnnotationBlock>,
		endLine: number,
		blocks: ParsedAnnotationBlock[]
	): void {
		if (currentBlock.id && currentBlock.zoteroLink && currentBlock.title) {
			blocks.push({
				id: currentBlock.id,
				zoteroLink: currentBlock.zoteroLink,
				title: currentBlock.title,
				pageNumber: currentBlock.pageNumber || '0',
				annotationText: currentBlock.annotationText || '',
				comments: currentBlock.comments || '',
				metadata: currentBlock.metadata!,
				rawText: currentBlock.rawText || '',
				startLine: currentBlock.startLine || 0,
				endLine: endLine
			});
		}
	}

	/**
	 * Validate if a string contains valid annotation blocks
	 */
	public static validateAnnotationBlocks(content: string): { isValid: boolean; errors: string[] } {
		const errors: string[] = [];
		const blocks = this.parseMarkdownFile(content);

		for (const block of blocks) {
			if (!block.id) {
				errors.push(`Block at line ${block.startLine} is missing an ID`);
			}
			
			if (!block.metadata) {
				errors.push(`Block at line ${block.startLine} is missing metadata`);
			}
			
			if (!block.zoteroLink || !block.zoteroLink.startsWith('zotero://')) {
				errors.push(`Block at line ${block.startLine} has invalid Zotero link`);
			}
		}

		return {
			isValid: errors.length === 0,
			errors
		};
	}
}
