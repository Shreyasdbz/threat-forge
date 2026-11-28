import { Loader2 } from "lucide-react";
import { extractDisplayContent, stripBlocksForStreaming } from "@/lib/ai/display-content";
import { MarkdownContent } from "../markdown-content";

export function AssistantContent({
	content,
	isStreaming,
}: {
	content: string;
	isStreaming: boolean;
}) {
	const displayContent = isStreaming
		? stripBlocksForStreaming(content)
		: extractDisplayContent(content);
	return (
		<div className="flex flex-col gap-2">
			{displayContent && <MarkdownContent content={displayContent} />}
			{isStreaming && (
				<Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none text-muted-foreground" />
			)}
		</div>
	);
}
