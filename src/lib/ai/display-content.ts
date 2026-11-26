/** Extract user-facing text from AI response. Uses <response> tags if present, falls back to block stripping. */
export function extractDisplayContent(content: string): string {
	const responseRegex = /<response>([\s\S]*?)<\/response>/g;
	const parts: string[] = [];
	let match = responseRegex.exec(content);
	while (match) {
		const trimmed = match[1].trim();
		if (trimmed) parts.push(trimmed);
		match = responseRegex.exec(content);
	}
	if (parts.length > 0) return parts.join("\n\n");

	// Fallback: strip fenced blocks and any response tags (backward compat with older/non-compliant responses)
	return content
		.replace(/```threats\n[\s\S]*?```/g, "")
		.replace(/```actions\n[\s\S]*?```/g, "")
		.replace(/<\/?response>/g, "")
		.trim();
}

/** Strip fenced code blocks during streaming (response tags may be incomplete). */
export function stripBlocksForStreaming(content: string): string {
	return content
		.replace(/```threats\n[\s\S]*?```/g, "")
		.replace(/```actions\n[\s\S]*?```/g, "")
		.replace(/<\/?response>/g, "")
		.replace(/<\/?resp(on(se?)?)?$/, "")
		.trim();
}
