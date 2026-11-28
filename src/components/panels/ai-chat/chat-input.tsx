import { ArrowUp, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import type { TurnState } from "@/lib/ai/loop/turn-machine";
import { cn } from "@/lib/utils";
import { useAiTurnStore } from "@/stores/ai-turn-store";
import { useChatStore } from "@/stores/chat-store";
import { useModelStore } from "@/stores/model-store";
import { ChatModelSelector } from "../chat-model-selector";

/** Turn phases in which a request or execution is in flight and can be stopped. */
function isTurnLive(phase: TurnState["phase"] | undefined): boolean {
	return (
		phase === "requesting" ||
		phase === "streaming" ||
		phase === "preparing_review" ||
		phase === "awaiting_approval" ||
		phase === "executing"
	);
}

export function ChatInput({ canSend }: { canSend: boolean }) {
	const submitTurn = useAiTurnStore((s) => s.submitTurn);
	const turnPhase = useAiTurnStore((s) => s.turn?.phase);
	const chatIsStreaming = useChatStore((s) => s.isStreaming);
	const stopGenerating = useChatStore((s) => s.stopGenerating);
	const model = useModelStore((s) => s.model);
	const activeSessionId = useChatStore((s) => s.activeSessionId);
	const input = useChatStore(
		(s) => s.sessions.find((session) => session.id === s.activeSessionId)?.draft ?? "",
	);
	const setInput = useChatStore((s) => s.setDraft);
	const inputRef = useRef<HTMLTextAreaElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resize when the controlled draft changes or the field becomes available
	useLayoutEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "0px";
		el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
	}, [input, canSend]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: focus the composer on chat selection
	useLayoutEffect(() => {
		// Key checks can mount the message field after a keyboard model change; keep selection focus.
		if (document.activeElement?.closest("[data-chat-model-picker]")) return;
		inputRef.current?.focus();
	}, [activeSessionId, canSend]);

	// Busy while a tool-loop turn is live or the legacy text stream is running.
	const isBusy = isTurnLive(turnPhase) || chatIsStreaming;

	// Keyboard shortcuts: Cmd+L to focus, Escape to stop generating
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			const mod = e.metaKey || e.ctrlKey;
			if (mod && e.key.toLowerCase() === "l" && inputRef.current) {
				e.preventDefault();
				inputRef.current?.focus();
			}
			// `stopGenerating` cancels both the chat stream and any live tool turn.
			const live =
				isTurnLive(useAiTurnStore.getState().turn?.phase) || useChatStore.getState().isStreaming;
			if (e.key === "Escape" && live) {
				stopGenerating();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [stopGenerating]);

	function handleSubmit() {
		const trimmed = input.trim();
		if (!trimmed || !canSend || isBusy || !model) return;

		setInput("");
		void submitTurn(trimmed, model);
	}

	function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
			e.preventDefault();
			handleSubmit();
		}
	}

	return (
		<Card
			size="sm"
			className="mt-3 min-w-0 shrink-0 overflow-visible border border-border py-0 has-[textarea:focus-visible]:outline-1 has-[textarea:focus-visible]:outline-foreground"
		>
			<fieldset aria-label="Message composer" className="min-w-0 p-2">
				{canSend && (
					<textarea
						ref={inputRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Ask about threats..."
						aria-label="Message AI assistant"
						rows={2}
						className="block max-h-40 w-full resize-none overflow-y-auto bg-transparent px-2 py-1 text-editor-body leading-relaxed placeholder:text-muted-foreground focus:outline-none"
					/>
				)}
				<div className="relative flex items-start justify-between gap-1">
					<ChatModelSelector disabled={isBusy} />
					{isBusy ? (
						<button
							type="button"
							onClick={stopGenerating}
							className="flex size-11 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent active:bg-accent focus-visible:outline-1 focus-visible:outline-foreground"
							title="Stop generating (Esc)"
							aria-label="Stop response"
						>
							<Square className="size-3 fill-current" />
						</button>
					) : canSend ? (
						<button
							type="button"
							onClick={handleSubmit}
							disabled={!input.trim()}
							className={cn(
								"flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:outline-1 focus-visible:outline-foreground",
								input.trim()
									? "text-foreground hover:bg-accent active:bg-accent"
									: "cursor-default text-muted-foreground opacity-50",
							)}
							title="Send (Enter)"
							aria-label="Send message"
						>
							<ArrowUp className="size-4" aria-hidden="true" />
						</button>
					) : null}
				</div>
				{(canSend || isBusy) && (
					<p role="status" className="sr-only">
						{turnPhase === "awaiting_approval"
							? "Review suggested changes"
							: isBusy
								? "Generating…"
								: "Enter to send"}
					</p>
				)}
			</fieldset>
		</Card>
	);
}
