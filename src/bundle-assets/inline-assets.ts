import { ungzip } from "pako";
import { patchPDFJSViewerHTML } from "./patch-inlined-assets";

const readerContext = require.context(
	"../../reader/reader/build/obsidian/",
	true,
	/.*/
);

const mimeTypes: Record<string, string> = {
	".pdf": "application/pdf",
	".wasm": "application/wasm",
	".mjs": "application/javascript",
	".js": "application/javascript",
	".json": "application/json",
	".txt": "text/plain",
	".css": "text/css",
	".html": "text/html",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".pfb": "application/x-font-type1",
	".otf": "font/otf",
	".eot": "application/vnd.ms-fontobject",
	".map": "application/json",
	".bcmap": "application/octet-stream",
	".icc": "application/vnd.iccprofile",
};

const ungzipBase64 = (base64: string) => {
	const gzippedBuffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const decompressedBuffer = ungzip(gzippedBuffer);

	return decompressedBuffer;
};

export function InitializeBlobUrls(): Record<string, string> {
	const BLOB_URL_MAP: Record<string, string> = {};
	const BLOB_BINARY_MAP: Record<string, { type: string; data: Uint8Array }> =
		{};

	readerContext.keys().forEach((key) => {
		const gzippedBase64 = readerContext(key).split(",")[1];
		const decompressedBase64 = ungzipBase64(gzippedBase64);
		const fileName = key.replace("./", "");
		const type =
			mimeTypes[fileName.slice(fileName.lastIndexOf("."))] ||
			"application/octet-stream";
		BLOB_BINARY_MAP[fileName] = {
			type: type,
			data: decompressedBase64,
		};

		const blob = new Blob([decompressedBase64 as BlobPart], {
			type: type,
		});
		const url = URL.createObjectURL(blob);
		BLOB_URL_MAP[fileName] = url;
	});

	// Patch the viewer.html
	const patchedViewerHTML = patchPDFJSViewerHTML(
		BLOB_BINARY_MAP,
		BLOB_URL_MAP
	);
	const blob = new Blob([patchedViewerHTML], { type: "text/html" });
	const url = URL.createObjectURL(blob);
	BLOB_URL_MAP["pdf/web/viewer.html"] = url;
	BLOB_URL_MAP["pdf/web/viewer.html.srcdoc"] = patchedViewerHTML;
	
	return BLOB_URL_MAP;
}
