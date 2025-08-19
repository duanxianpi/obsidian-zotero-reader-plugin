export function extractObsidianStyles() {
	const extractCSSVariables = (selector: string): Record<string, string> => {
		const variables: Record<string, string> = {};

		Array.from(document.styleSheets)
			.filter(
				(sheet) =>
					sheet.href === null ||
					sheet.href.startsWith(window.location.origin)
			)
			.forEach((sheet) => {
				try {
					Array.from(sheet.cssRules).forEach((rule) => {
						const styleRule = rule as CSSStyleRule;
						if (
							styleRule.selectorText === selector &&
							styleRule.style
						) {
							Array.from(styleRule.style).forEach((name) => {
								if (name.startsWith("--")) {
									variables[name] =
										styleRule.style.getPropertyValue(name);
								}
							});
						}
					});
				} catch (e) {
					console.warn("Could not access stylesheet rules:", e);
				}
			});

		return variables;
	};
	const bodyVariables = extractCSSVariables("body");
	const themeLightVariables = extractCSSVariables(".theme-light");
	const themeDarkVariables = extractCSSVariables(".theme-dark");
	const themeDLVariables = extractCSSVariables(".theme-dark, .theme-light");
	const themeLDVariables = extractCSSVariables(".theme-light, .theme-dark");

	return {
		body: bodyVariables,
		".obsidian-theme-light": themeLightVariables,
		".obsidian-theme-dark": themeDarkVariables,
		".obsidian-theme-light, .obsidian-theme-dark": {
			...themeDLVariables,
			...themeLDVariables,
		},
	};
}

