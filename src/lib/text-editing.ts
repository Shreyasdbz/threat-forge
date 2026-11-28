const textInputTypes = new Set(["email", "number", "password", "search", "tel", "text", "url"]);

export function isTextEditing(element: Element | null): boolean {
	if (element instanceof HTMLInputElement) {
		return !element.readOnly && !element.disabled && textInputTypes.has(element.type);
	}
	if (element instanceof HTMLTextAreaElement) {
		return !element.readOnly && !element.disabled;
	}
	return element instanceof HTMLElement && element.isContentEditable;
}
