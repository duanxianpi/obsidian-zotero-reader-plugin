import * as cheerio from "cheerio";

/**
 * This function is used to patch the viewer.css file, since css cannot use blob URLs directly.
 * It will replace the original URLs with data URLs instead.
 */

function getPatchedViewerCSS(
	BLOB_BINARY_MAP: Record<string, { type: string; data: Uint8Array }>
): string {
	const originalCSS = BLOB_BINARY_MAP["pdf/web/viewer.css"];
	// Convert the Uint8Array to a string
	const text = new TextDecoder("utf-8").decode(originalCSS.data);

	// For css, if it contains relative URLs, we need to adjust them
	const relativeUrlPattern =
		/url\(\s*(['"]?)(?![a-z][\w+.-]*:|\/\/)([^'")]+)\1\s*\)/g;
	const adjustedCss = text.replace(
		relativeUrlPattern,
		(match, quote, url) => {
			// Get the base64 data from the inline resources
			const hit = Object.keys(BLOB_BINARY_MAP).find((k) =>
				k.includes(url.match(/([^\/?#]+)(?:\?.*)?$/)[1])
			);
			if (hit) {
				const base64 = BLOB_BINARY_MAP[hit].data;
				const mimeType = BLOB_BINARY_MAP[hit].type || "text/css";
				return `url("data:${mimeType};base64,${base64}")`;
			} else {
				console.warn(`No inline resource found for ${url}`);
				return match; // Return the original match if no resource found
			}
		}
	);

	return adjustedCss;
}

/** This function is used to patch the PDF viewer HTML file to use the blob URLs
 * for inline resources instead of the original URLs.
 * The following will be replaced in the viewer.html:
 * • fetch
 * • XMLHttpRequest
 * • Worker
 */
export function patchPDFViewerHTML(
	BLOB_BINARY_MAP: Record<string, { type: string; data: Uint8Array }>,
	BLOB_URL_MAP: Record<string, string>
) {
	let originalHTML = BLOB_BINARY_MAP["pdf/web/viewer.html"].data;
	const BOM = [0xef, 0xbb, 0xbf];
	if (
		originalHTML[0] === BOM[0] &&
		originalHTML[1] === BOM[1] &&
		originalHTML[2] === BOM[2]
	) {
		originalHTML = originalHTML.slice(3);
	}
	const text = new TextDecoder("utf-8").decode(originalHTML);

	const $ = cheerio.load(text);

	// <link rel="stylesheet">
	// Obisidian didn't support blob for href, so we need to inline the CSS
	// and replace the link tag with a style tag
	$('link[rel="stylesheet"][href="viewer.css"]').each((_, elem) => {
		const href = $(elem).attr("href");
		// get the content of the CSS file
		$(elem).replaceWith(
			`<style>${getPatchedViewerCSS(BLOB_BINARY_MAP)}</style>`
		);
	});

	// <script type="module" src="…">
	$('script[type="module"][src]').each((_, elem) => {
		const src = $(elem).attr("src");
		const hit = Object.keys(BLOB_URL_MAP).find((k) =>
			k.includes(src?.match(/([^\/?#]+)(?:\?.*)?$/)?.at(1)!)
		);
		if (hit) {
			const url = BLOB_URL_MAP[hit];
			$(elem).attr("src", url);
		} else {
			console.warn(`No blob URL found for ${src}`);
		}
	});

	// Monkey patch for fetch and XMLHttpRequest
	// Since the viewer.html will be loaded in iframe, patching the
	// fetch and XMLHttpRequest won't cause issues with the main app.
	$("head").prepend(`
<script type="module">

	/** Find matching resource key and return its blob URL */
	function getBlobUrlForRequest(requestedUrl) {
		const isRelative = (u) => !/^[a-zA-Z][a-zA-Z\\d+\\-.]*:/.test(u) && !u.startsWith("//");

		if (isRelative(requestedUrl)) {
			// For relative URLs, lookuping in the 
			return globalThis.BLOB_URL_MAP[requestedUrl] || 
				globalThis.BLOB_URL_MAP[Object.keys(globalThis.BLOB_URL_MAP).find(key => 
					key.includes(requestedUrl.match(/([^\\/?#]+)(?:\\?.*)?$/)[1])
				)];
		}
	}

	// ---------- patched fetch ----------
	const realFetch = window.fetch.bind(window);

	window.fetch = async function patchedFetch(input, init) {
	const url = typeof input === "string" ? input
		: input instanceof Request ? input.url
		: input instanceof URL ? input.toString()
		: "";

	const blobUrl = getBlobUrlForRequest(url);
	if (blobUrl) {
		// Redirect to blob URL
		return realFetch(blobUrl, init);
	}

	return realFetch(input, init);
	};

	// ---------- patched XMLHttpRequest ----------
	const NativeXHR = window.XMLHttpRequest;

	function PatchedXHR() {
	/* Real XHR that will do the work */
	const real = new NativeXHR();

	/* Intercept all property access with a proxy */
	return new Proxy(real, {
		get(target, prop, receiver) {
		/* Intercept .open() and rewrite the URL if we have a blob */
		if (prop === 'open') {
			return function open(method, url, async = true, user, pw) {
			const mapped = getBlobUrlForRequest(url);
			return target.open.call(
				target,
				method,
				mapped || url,
				async,
				user,
				pw
			);
			};
		}

		/* Any other function ⇒ bind real as ‘this’ so callbacks behave */
		const value = Reflect.get(target, prop, receiver);
		if (typeof value === 'function') {
			return value.bind(target);
		}
		return value;
		},

		/* Simple forwarding setter */
		set(target, prop, value) {
		target[prop] = value;
		return true;
		}
	});
	}

	/* Copy static constants such as XMLHttpRequest.DONE, OPENED… */
	Object.getOwnPropertyNames(NativeXHR).forEach((k) => {
	if (!(k in PatchedXHR)) {
		Object.defineProperty(
		PatchedXHR,
		k,
		Object.getOwnPropertyDescriptor(NativeXHR, k)
		);
	}
	});

	/* Replace the global constructor */
	window.XMLHttpRequest = PatchedXHR;

	// Test the patched fetch
	 fetch('standard_fonts/FoxitFixedBoldItalic.pfb').then((response) => {
		if (response.ok) {
			console.debug('Font loaded successfully via blob URL fetch');
			return response.arrayBuffer();
		}
	}).then(buffer => {
		if (buffer) console.debug('Font data:', buffer.byteLength, 'bytes');
	});

	// Test the patched XMLHttpRequest
	const xhr = new XMLHttpRequest();
	xhr.open('GET', 'standard_fonts/FoxitFixedBoldItalic.pfb', true);
	xhr.responseType = 'arraybuffer';
	xhr.onload = function () {
	console.debug('Font loaded successfully via blob URL XHR');
	console.debug('Font data:', this.response.byteLength, 'bytes');
	};
	xhr.send();
</script>
		`);

	// Passing the globalThis.BLOB_URL_MAP to the viewer.html as a map
	$("head").prepend(`
<script type="module">
	globalThis.BLOB_URL_MAP = ${JSON.stringify(BLOB_URL_MAP)};
</script>
	`);

	// Patch the pdf.worker.js script tag
	$("head").append(`
<script type="module">PDFViewerApplicationOptions.set('workerSrc', globalThis.BLOB_URL_MAP["pdf/build/pdf.worker.mjs"]);</script>
	`);

	const patchedHTML = $.html();
	const byteNumbers = Array.from(patchedHTML, (char) => char.charCodeAt(0));
	const byteArray = new Uint8Array(byteNumbers);
	const blob = new Blob([byteArray], {
		type: "text/html",
	});
	const url = URL.createObjectURL(blob);
	console.info(`Patched viewer.html with blob URL: ${url}`);
	return url;
}
