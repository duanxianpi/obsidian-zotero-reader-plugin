import { ParsedAnnotation, ZoteroAnnotation } from "../types/zotero-reader";

/** Internal constants for the block markers */
export const OzrpAnnoMarks = {
	BEGIN: "%% OZRP-ANNO-BEGIN {{rawJson}} %%",
	END: "%% OZRP-ANNO-END %%",
	Q_BEGIN: "%% OZRP-ANNO-QUOTE-BEGIN %%",
	Q_END: "%% OZRP-ANNO-QUOTE-END %%",
	C_BEGIN: "%% OZRP-ANNO-COMM-BEGIN %%",
	C_END: "%% OZRP-ANNO-COMM-END %%",
	BLOCKS_BEGIN: "%% OZRP-ANNO-BLOCKS-BEGIN %%",
	BLOCKS_END: "%% OZRP-ANNO-BLOCKS-END %%",
} as const;

/**
 * We match entire sections including markers, capturing the inner body for parsing.
 * Leading blockquote/space prefixes are tolerated and normalized out during parsing.
 */

const SECTION_WITH_MARKERS_RE = new RegExp(
	String.raw`(%%\s*OZRP-ANNO-BEGIN` + // group 1: begin line (with trailing NL)
		String.raw`[\t\s]*` +
		String.raw`(\{[\s\S]*?\})` + // group 2: grab the JSON object
		String.raw`\s*%%[\t\s]*(?:\r?\n))` +
		String.raw`([\s\S]*?)` + // group 3: inner body (non-greedy)
		String.raw`(?=%%\s*OZRP-ANNO-END\s*%%)`, // lookahead up to END line
	"gm"
);

const SECTION_END_LINE_RE = /%%\s*OZRP-ANNO-END\s*%%/gm;

// Inside a normalized section (no leading ">"), capture header + chunks
const HEADER_LINE_RE = /^(?:\s*>\s*)?\[!info\][\s\S]*$/m; // optional, very loose
const QUOTE_BLOCK_RE = new RegExp(
	String.raw`%%\s*OZRP-ANNO-QUOTE-BEGIN\s*%%\s*\r?\n?` +
		String.raw`([\s\S]*?)` +
		String.raw`\r?\n?%%\s*OZRP-ANNO-QUOTE-END\s*%%`,
	"m"
);
const COMM_BLOCK_RE = new RegExp(
	String.raw`%%\s*OZRP-ANNO-COMM-BEGIN\s*%%\s*\r?\n?` +
		String.raw`([\s\S]*?)` +
		String.raw`\r?\n?%%\s*OZRP-ANNO-COMM-END\s*%%`,
	"m"
);
const JSON_INLINE_RE = new RegExp(
	String.raw`%%\s*OZRP-ANNO-JSON-BEGIN\b` +
		String.raw`[\t ]*` +
		String.raw`(\{[\s\S]*?\})` + // grab the JSON object between the nearest braces
		String.raw`\s*OZRP-ANNO-JSON-END\s*%%`,
	"m"
);

/** Strip a single leading blockquote / whitespace prefix from each line. */
function stripBlockquotePrefix(text: string): string {
	return text
		.split(/\r?\n/)
		.map((line) => line.replace(/^[>\t ]+/, ""))
		.join("\n")
		.trim();
}

/** Normalize a captured section body so inner markers are visible (remove ">/spaces"). */
function normalizeSectionBody(sectionBody: string): string {
	return sectionBody
		.split(/\r?\n/)
		.map((line) => line.replace(/^[>\t ]+/, ""))
		.join("\n");
}

/** Extracts header (first non-empty quoted line that looks like a callout) */
function extractHeader(normalized: string): string | undefined {
	const m = normalized.match(HEADER_LINE_RE);
	if (!m) return undefined;
	// Trim any leading blockquote remnants that may have survived normalization
	return stripBlockquotePrefix(m[0]);
}

/** Safe JSON parse with better error messages */
function tryParseJsonFrom(jsonRaw: string): {
	json?: any;
	error?: string;
} {
	try {
		return { json: JSON.parse(jsonRaw) };
	} catch (e: any) {
		console.warn("Error parsing annotation JSON:", e);
		return { error: `Invalid JSON: ${e?.message || e}` };
	}
}

export class AnnotationParser {
	/** Parses a file’s markdown content into structured annotations with ranges */
	public static parseWithRanges(
		content: string
	): Map<string, ParsedAnnotation> {
		const out: Map<string, ParsedAnnotation> = new Map();

		// Multi-pass: we first find each section body by matching BEGIN..(lookahead) END,
		// then seek the END line to include it in the raw span.
		let match: RegExpExecArray | null;
		while ((match = SECTION_WITH_MARKERS_RE.exec(content)) !== null) {
			const beginLineWithNL = match[1] || ""; // included to compute raw span
			const jsonRaw = match[2] || ""; // the JSON object
			const bodyRaw = match[3] || "";
			const bodyStart = match.index + beginLineWithNL.length;

			// Find the END line that follows this match
			SECTION_END_LINE_RE.lastIndex = bodyStart + bodyRaw.length;
			const endLineMatch = SECTION_END_LINE_RE.exec(content);
			if (!endLineMatch) continue; // malformed – skip

			const rawStart = match.index;
			const rawEnd = endLineMatch.index + endLineMatch[0].length; // inclusive of END line
			const raw = content.slice(rawStart, rawEnd);

			// Normalize to remove ">"/spaces so inner markers are visible
			const normalized = normalizeSectionBody(bodyRaw);

			// Extract parts
			const header = extractHeader(normalized);

			const qm = QUOTE_BLOCK_RE.exec(normalized);
			const cm = COMM_BLOCK_RE.exec(normalized);
			const { json, error: jsonErr } = tryParseJsonFrom(jsonRaw);

			// Reset lastIndex for safety (these are not /g, but future-proof)
			// N/A here – but keep note if toggled later

			if (!qm || !cm || !json) {
				// Skip but keep going; robust parser should not bail entire loop
				// You can also push a diagnostic object here if desired
				continue;
			}

			const text = stripBlockquotePrefix(qm[1] || "");
			const comment = stripBlockquotePrefix(cm[1] || "");
			const id = json.id;

			out.set(id, {
				id,
				header,
				text,
				comment,
				json,
				range: { start: rawStart, end: rawEnd },
				raw,
			});
		}

		return out;
	}

	public static async validateFileAnnotations(content: string): Promise<
		Array<{
			id?: string;
			range: { start: number; end: number };
			problem: string;
			hint?: string;
		}>
	> {
		const issues: Array<{
			id?: string;
			range: { start: number; end: number };
			problem: string;
			hint?: string;
		}> = [];

		let match: RegExpExecArray | null;
		SECTION_WITH_MARKERS_RE.lastIndex = 0;

		while ((match = SECTION_WITH_MARKERS_RE.exec(content)) !== null) {
			const beginLineWithNL = match[1] || "";
			const jsonRaw = match[2] || ""; // the JSON object
			const bodyRaw = match[3] || "";
			const bodyStart = match.index + beginLineWithNL.length;

			SECTION_END_LINE_RE.lastIndex = bodyStart + bodyRaw.length;
			const endLineMatch = SECTION_END_LINE_RE.exec(content);
			if (!endLineMatch) {
				issues.push({
					range: {
						start: match.index,
						end: match.index + (match[0]?.length ?? 0),
					},
					problem: "Missing END marker",
					hint: `Ensure a line exactly like: ${OzrpAnnoMarks.END}`,
				});
				continue;
			}

			const rawStart = match.index;
			const rawEnd = endLineMatch.index + endLineMatch[0].length;
			const bodyNorm = normalizeSectionBody(bodyRaw);

			const qm = QUOTE_BLOCK_RE.exec(bodyNorm);
			const cm = COMM_BLOCK_RE.exec(bodyNorm);
			const { json, error } = tryParseJsonFrom(jsonRaw);

			if (!qm) {
				issues.push({
					range: { start: rawStart, end: rawEnd },
					problem: "Missing quote block",
					hint: `${OzrpAnnoMarks.Q_BEGIN} … ${OzrpAnnoMarks.Q_END}`,
				});
			}
			if (!cm) {
				issues.push({
					range: { start: rawStart, end: rawEnd },
					problem: "Missing comment block",
					hint: `${OzrpAnnoMarks.C_BEGIN} … ${OzrpAnnoMarks.C_END}`,
				});
			}
			if (error) {
				issues.push({
					range: { start: rawStart, end: rawEnd },
					problem: error,
					hint: `${OzrpAnnoMarks.BEGIN} { … }`,
				});
			}
		}

		return issues;
	}
}
