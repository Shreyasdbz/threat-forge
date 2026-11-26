import { Loader2 } from "lucide-react";
import { memo } from "react";
import { flattenText, type ProtocolMessage } from "@/lib/ai/protocol/messages";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/stores/chat-store";
import { ChatViewport } from "../chat-viewport";
import { AssistantContent } from "./assistant-content";

export function MessageList({
	messages,
	isStreaming,
	fencedEnabled,
}: {
	messages: ChatMessage[];
	isStreaming: boolean;
	fencedEnabled: boolean;
}) {
	const visibleMessages = messages.filter(hasVisibleText);
	if (messages.length === 0) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<div className="my-auto flex shrink-0 flex-col items-center gap-2 py-8 text-center">
					<p className="text-editor-footnote">Explore your threat model</p>
					<p className="max-w-64 px-2 text-editor-caption leading-relaxed text-muted-foreground">
						Ask about your architecture, find threats, or work through a mitigation.
					</p>
				</div>
			</div>
		);
	}

	return (
		<ChatViewport activity={messages}>
			{visibleMessages.map((msg, i) => (
				<MessageBubble
					// biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only
					key={i}
					message={msg}
					fencedEnabled={fencedEnabled}
					isLast={i === visibleMessages.length - 1}
					isStreaming={isStreaming && i === visibleMessages.length - 1 && msg.role === "assistant"}
				/>
			))}
			{isStreaming && (
				<div
					role="status"
					className="flex items-center gap-2 px-1 text-editor-caption text-muted-foreground"
				>
					<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> Thinking…
				</div>
			)}
		</ChatViewport>
	);
}

/** A message that renders as a chat bubble; tool_result carriers and empty turns are internal. */
export function hasVisibleText(message: ProtocolMessage): boolean {
	return message.content.some((block) => block.type === "text" && block.text.trim().length > 0);
}

export const MessageBubble = memo(function MessageBubble({
	message,
	isLast,
	isStreaming,
	fencedEnabled = true,
}: {
	message: ProtocolMessage;
	isLast: boolean;
	isStreaming: boolean;
	/** Whether fenced ` ```actions ` parsing runs; a tool-enabled turn disables it. */
	fencedEnabled?: boolean;
}) {
	const isUser = message.role === "user";
	// Messages carry block content now; the bubble renders the accumulated text.
	// The assistant's fenced ` ```actions `/` ```threats ` blocks live inside this
	// text and are parsed only through the legacy boundary in `AssistantContent`.
	const displayText = flattenText(message);

	return (
		<div className={cn("min-w-0", isUser ? "flex justify-end" : "w-full")}>
			<div
				className={cn(
					"min-w-0 text-[13px] leading-relaxed [overflow-wrap:anywhere]",
					isUser
						? "max-w-[90%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-secondary-foreground"
						: "w-full px-1 text-foreground",
				)}
			>
				{isUser ? (
					<p className="whitespace-pre-wrap">{displayText}</p>
				) : (
					<AssistantContent
						content={displayText}
						isStreaming={isStreaming}
						isLast={isLast}
						fencedEnabled={fencedEnabled}
					/>
				)}
			</div>
		</div>
	);
});
