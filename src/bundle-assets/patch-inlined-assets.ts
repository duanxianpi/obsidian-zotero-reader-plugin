/** -----------------------------------------------------------
 * This function is used to patch the viewer.css file, since css cannot use blob URLs directly.
 * It will replace the original URLs with data URLs instead.
 * ------------------------------------------------------------
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
				const base64 = btoa(
					String.fromCharCode.apply(null, BLOB_BINARY_MAP[hit].data)
				);
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

/** -----------------------------------------------------------
 * This function is used to patch the PDF viewer HTML file to use the blob URLs
 * for inline resources instead of the original URLs.
 * The following will be replaced in the viewer.html:
 * - fetch
 * - XMLHttpRequest
 * ------------------------------------------------------------
 */
export function patchPDFJSViewerHTML(
	BLOB_BINARY_MAP: Record<string, { type: string; data: Uint8Array }>,
	BLOB_URL_MAP: Record<string, string>
) {
	// Get original HTML bytes
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

	// Parse into a DOM
	const parser = new DOMParser();
	const doc = parser.parseFromString(text, "text/html");

	// Guard: ensure <head> exists (PDF viewer.html should have it)
	const head = doc.head || doc.getElementsByTagName("head")[0];

	const cssLinks = doc.querySelectorAll(
		'link[rel="stylesheet"][href="viewer.css"]'
	);
	cssLinks.forEach((linkEl) => {
		const styleEl = doc.createElement("style");
		styleEl.textContent = getPatchedViewerCSS(BLOB_BINARY_MAP);
		linkEl.replaceWith(styleEl);
	});

	// Rewrite <script type="module" src="...">
	const moduleScripts = doc.querySelectorAll('script[type="module"][src]');
	moduleScripts.forEach((scriptEl) => {
		const src = scriptEl.getAttribute("src") || "";
		// Find a key whose basename matches (similar to your RegExp logic)
		const basenameMatch = src.match(/([^\/?#]+)(?:\?.*)?$/);
		const basename = basenameMatch?.[1];
		if (basename) {
			const hit = Object.keys(BLOB_URL_MAP).find((k) =>
				k.includes(basename)
			);
			if (hit) {
				scriptEl.setAttribute("src", BLOB_URL_MAP[hit]);
			} else {
				console.warn(`No blob URL found for ${src}`);
			}
		}
	});

	// Build the patch scripts (order: first the map, then the monkey patch)
	const blobMapScript = doc.createElement("script");
	blobMapScript.type = "module";
	blobMapScript.textContent = `
    globalThis.BLOB_URL_MAP = globalThis.parent.BLOB_URL_MAP;
  `.trim();

	const patchScript = doc.createElement("script");
	patchScript.type = "module";
	patchScript.textContent = `
    /** Find matching resource key and return its blob URL */
    function getBlobUrlForRequest(requestedUrl) {
      const isRelative = (u) => !/^[a-zA-Z][a-zA-Z\\d+\\-.]*:/.test(u) && !u.startsWith("//");
      if (isRelative(requestedUrl)) {
        return globalThis.BLOB_URL_MAP[requestedUrl] ||
          globalThis.BLOB_URL_MAP[
            Object.keys(globalThis.BLOB_URL_MAP).find(key =>
              key.includes(requestedUrl.match(/([^\\/?#]+)(?:\\?.*)?$/)[1])
            )
          ];
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
        // If the request is for a blob URL, we return the blob URL directly
        console.debug("Patched fetch for URL:", url, "-> Blob URL:", blobUrl);
        return realFetch(blobUrl, init);
      }
      return realFetch(input, init);
    };

    // ---------- patched XMLHttpRequest ----------
    const NativeXHR = window.XMLHttpRequest;
    function PatchedXHR() {
      const real = new NativeXHR();
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'open') {
            return function open(method, url, async = true, user, pw) {
              const mapped = getBlobUrlForRequest(url);
              // If the request is for a blob URL, we return the blob URL directly
              mapped && console.debug("Patched XHR open for URL:", url, "-> Blob URL:", mapped);
              return target.open.call(target, method, mapped || url, async, user, pw);
            };
          }
          const value = Reflect.get(target, prop, receiver);
            if (typeof value === 'function') return value.bind(target);
          return value;
        },
        set(target, prop, value) {
          (target)[prop] = value;
          return true;
        }
      });
    }
    Object.getOwnPropertyNames(NativeXHR).forEach(k => {
      if ((k in PatchedXHR)) {
        Object.defineProperty(
          PatchedXHR,
          k,
          Object.getOwnPropertyDescriptor(NativeXHR, k)
        );
      }
    });
    window.XMLHttpRequest = PatchedXHR;

    // Test patched fetch
    // fetch('standard_fonts/FoxitFixedBoldItalic.pfb')
    //   .then(r => r.ok ? r.arrayBuffer() : null)
    //   .then(buf => {
    //     if (buf) console.debug('Font data (fetch):', buf.byteLength, 'bytes');
    //   });

    // Test patched XHR
    // const xhr = new XMLHttpRequest();
    // xhr.open('GET', 'standard_fonts/FoxitFixedBoldItalic.pfb', true);
    // xhr.responseType = 'arraybuffer';
    // xhr.onload = function () {
    //   if (this.response) {
    //     console.debug('Font data (XHR):', this.response.byteLength, 'bytes');
    //   }
    // };
    // xhr.send();
  `.trim();

	// Insert both at head start (prepend order: second inserted first so final order is map then patch)
	if (head.firstChild) {
		head.insertBefore(patchScript, head.firstChild);
		head.insertBefore(blobMapScript, head.firstChild);
	} else {
		head.appendChild(blobMapScript);
		head.appendChild(patchScript);
	}

	// 7. Serialize DOM back to HTML
	// Keep existing DOCTYPE if present
	const doctype = Array.from(doc.childNodes).find(
		(n) => n.nodeType === Node.DOCUMENT_TYPE_NODE
	) as DocumentType | undefined;

	const serialized =
		(doctype ? `<!DOCTYPE ${doctype.name}>\n` : "<!DOCTYPE html>\n") +
		doc.documentElement.outerHTML;

	// 8. Make blob URL
	const blob = new Blob([serialized], { type: "text/html" });
	const url = URL.createObjectURL(blob);
	console.info(`Patched viewer.html with blob URL: ${url}`);
	return url;
}
