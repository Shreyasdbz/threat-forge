import { AlertCircle, AlertTriangle, Bot, Settings } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { KEY_STORAGE_UNREADABLE } from "@/lib/adapters/keychain-adapter";
import { useAiTurnStore } from "@/stores/ai-turn-store";
import { useChatStore } from "@/stores/chat-store";
import { useDocumentRegistry } from "@/stores/document-registry";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import { ChatInput } from "./ai-chat/chat-input";
import { MessageList } from "./ai-chat/chat-transcript";
import { TurnConversation } from "./ai-chat/turn-conversation";
import { ChatSessionPicker } from "./chat-session-picker";

export function AiChatTab() {
	const model = useModelStore((s) => s.model);
	const filePath = useModelStore((s) => s.filePath);
	const activeDocumentId = useDocumentRegistry((s) => s.activeDocumentId);
	const hasApiKey = useChatStore((s) => s.hasApiKey);
	const keyFault = useChatStore((s) => s.keyFault);
	const checkApiKey = useChatStore((s) => s.checkApiKey);
	const loadSessionsForFile = useChatStore((s) => s.loadSessionsForFile);
	const openSettingsDialogAtTab = useSettingsStore((s) => s.openSettingsDialogAtTab);

	// Check API key on mount
	useEffect(() => {
		void checkApiKey();
	}, [checkApiKey]);

	// The registry owns document binding and Save As. Standalone callers without
	// a registered document retain the text-only chat path.
	useEffect(() => {
		if (!activeDocumentId && !useChatStore.getState().sessionKey) loadSessionsForFile(filePath);
	}, [activeDocumentId, filePath, loadSessionsForFile]);

	if (!model) {
		return (
			<p className="text-editor-caption text-muted-foreground">
				Open a threat model to use AI assistance.
			</p>
		);
	}

	const openAiSettings = () => openSettingsDialogAtTab("ai");

	return (
		<div data-ai-chat className="flex h-full min-h-0 min-w-0 flex-col">
			{/* Header with settings */}
			<div className="mb-1 flex h-11 shrink-0 items-center justify-between">
				<h2 className="text-editor-title3">AI Assistant</h2>
				<button
					type="button"
					onClick={openAiSettings}
					className="flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent focus-visible:outline-1 focus-visible:outline-foreground"
					aria-label="AI Settings"
					title="AI Settings"
				>
					<Settings className="h-3.5 w-3.5" />
				</button>
			</div>
			{/* The fault outranks the absence: it is the stronger and truer claim about the same
			    storage, mirroring the documented precedence in the settings panel's
			    `statusToneOf`. Reporting "no API key configured" over a vault nobody could read
			    points the user at entering a key, which is the one thing that will not help. */}
			{keyFault ? (
				<KeyStorageFault message={keyFault} onConfigure={openAiSettings} />
			) : !hasApiKey ? (
				<EmptyState onConfigure={openAiSettings} />
			) : (
				<ChatView />
			)}
			<ChatInput canSend={hasApiKey && !keyFault} />
		</div>
	);
}

/**
 * What the chat surface shows when key storage could not be read at all (#234).
 *
 * The heading is {@link KEY_STORAGE_UNREADABLE}, the same constant the settings panel's status
 * row renders, so a user who checks both surfaces reads one sentence rather than two accounts
 * of one fault. Shared as a constant rather than as matching literals: this issue exists
 * because two surfaces disagreed about one stored key, and a copy edit that reached only one
 * of them would be the same defect in a quieter form.
 *
 * The remedy is the keychain's own authored message, rendered verbatim — no copy is invented
 * here. What keeps an internal string out of it is upstream, not this component: every browser
 * fault is remapped to an authored `KeyVaultError` by `withVault`, and the desktop adapter
 * relays a sentence authored in Rust.
 *
 * The button promises exactly what it does. It opens settings; it does not promise a fix,
 * because for an `unavailable` fault — an insecure origin with no Web Crypto — entering a key
 * there changes nothing. Amber rather than destructive red for the reason the panel records:
 * red belongs to a credential exposed in clear text, and this is a loss of function.
 *
 * `role="alert"` is assertive deliberately. This replaces the whole conversation surface after
 * a check the user did not initiate — on a provider switch, or a re-check that newly fails
 * while the transcript is on screen, a screen-reader user told about it late has already been
 * typing into a panel that was never going to send. (On first mount there is no input yet, so
 * that path is the one that earns the interruption.)
 */
function KeyStorageFault({ message, onConfigure }: { message: string; onConfigure: () => void }) {
	return (
		<div role="alert" data-testid="key-storage-fault" className="flex flex-1 flex-col">
			<div className="my-auto flex shrink-0 flex-col items-center gap-3 px-2 py-4 text-center">
				<AlertTriangle className="size-4 shrink-0 text-editor-warning" />
				<div>
					<p className="text-editor-headline text-editor-warning">{KEY_STORAGE_UNREADABLE}</p>
					<p className="mt-1 text-editor-caption leading-relaxed text-muted-foreground">
						{message}
					</p>
				</div>
				<Button
					type="button"
					variant="outline"
					onClick={onConfigure}
					className="h-11 text-editor-footnote"
				>
					Open AI settings
				</Button>
			</div>
		</div>
	);
}

function EmptyState({ onConfigure }: { onConfigure: () => void }) {
	return (
		<div className="flex flex-1 flex-col">
			<Empty className="my-auto flex-none rounded-none px-2 py-4">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Bot aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle className="text-editor-title3 tracking-normal">
						No API key configured
					</EmptyTitle>
					<EmptyDescription className="text-editor-body">
						Add your Anthropic or OpenAI API key to get AI-powered threat analysis.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button
						type="button"
						variant="outline"
						onClick={onConfigure}
						className="min-h-11 text-editor-footnote"
					>
						Configure API Key
					</Button>
				</EmptyContent>
			</Empty>
		</div>
	);
}

function ChatView() {
	const messages = useChatStore((s) => s.messages);
	const isStreaming = useChatStore((s) => s.isStreaming);
	const error = useChatStore((s) => s.error);
	const clearError = useChatStore((s) => s.clearError);
	// The live tool-loop turn (issue #62) owns the conversation once one starts;
	// before that, the pre-loop transcript renders as it always has.
	const turn = useAiTurnStore((s) => s.turn);
	const activeSessionId = useChatStore((s) => s.activeSessionId);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
			{/* Session bar */}
			<ChatSessionPicker />

			{/* Messages area */}
			{turn ? (
				<TurnConversation key={activeSessionId} turn={turn} />
			) : (
				<MessageList
					key={activeSessionId}
					messages={messages}
					isStreaming={isStreaming}
					fencedEnabled={false}
				/>
			)}

			{/* Error display */}
			{error && (
				<div className="flex items-start gap-1.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-editor-caption leading-relaxed text-foreground">
					<AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
					<div className="flex-1">{error}</div>
					<button
						type="button"
						onClick={clearError}
						className="shrink-0 text-editor-caption2 underline"
					>
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}
