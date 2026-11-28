import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRequest, StreamConversationHandlers } from "@/lib/ai/protocol/client";
import type { StreamEvent } from "@/lib/ai/protocol/events";
import { DEFAULT_ANTHROPIC_MODEL } from "@/lib/ai-models";
import { buildSystemPrompt } from "@/lib/ai-prompt";
import { useDocumentRegistry } from "@/stores/document-registry";
import { createDocumentStores, setActiveStores } from "@/stores/document-stores";
import { useHistoryStore } from "@/stores/history-store";
import { useModelStore } from "@/stores/model-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ThreatModel } from "@/types/threat-model";
import { useAiTurnStore } from "./ai-turn-store";
import { useChatStore } from "./chat-store";

const streamConversationMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/ai/protocol/client", () => ({ streamConversation: streamConversationMock }));
vi.mock("@/lib/adapters/get-chat-transport", () => ({
	getChatTransport: () => Promise.resolve({ open: vi.fn() }),
}));

function applyReviewedProposal(): void {
	const store = useAiTurnStore.getState();
	const review = store.turn?.proposal;
	if (!review) throw new Error("Expected a proposal ready for review");
	store.applyProposal(review.token);
}

const model: ThreatModel = {
	version: "1.0",
	metadata: {
		title: "T",
		author: "A",
		created: "2026-01-01",
		modified: "2026-01-01",
		description: "",
	},
	elements: [
		{
			id: "web-app",
			type: "process",
			name: "Web App",
			trust_zone: "internal",
			description: "",
			technologies: [],
		},
	],
	data_flows: [],
	trust_boundaries: [],
	threats: [],
	diagrams: [],
};

/** Queue one scripted event list per provider request. */
function script(...responses: StreamEvent[][]): void {
	let index = 0;
	streamConversationMock.mockImplementation(
		async (
			_request: unknown,
			_transport: unknown,
			handlers: StreamConversationHandlers,
			signal?: AbortSignal,
		) => {
			const events = responses[index] ?? [
				{ type: "message_start", model: "m" },
				{ type: "message_stop", stopReason: "end_turn" },
			];
			index += 1;
			for (const event of events) {
				if (signal?.aborted) {
					handlers.onEvent({ type: "aborted" });
					return;
				}
				handlers.onEvent(event);
			}
		},
	);
}

/** Drain the microtask/timer queue so the fire-and-forget runner settles. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	useAiTurnStore.getState().resetTurn();
	useDocumentRegistry.setState({ documents: {}, openDocumentIds: [], activeDocumentId: null });
	setActiveStores(createDocumentStores());
	useModelStore.getState().clearModel();
	useHistoryStore.getState().clear();
	useModelStore.getState().setModel(structuredClone(model), null);
	useHistoryStore.getState().clear();
	useChatStore.setState({
		provider: "anthropic",
		documentId: null,
		activeSessionId: null,
		sessionKey: null,
		sessions: [],
		messages: [],
	});
	useSettingsStore.setState((state) => ({
		settings: { ...state.settings, aiModelAnthropic: DEFAULT_ANTHROPIC_MODEL },
	}));
});

describe("submitTurn against a tool-capable model", () => {
	it("pauses for approval, commits on approve, and settles completed", async () => {
		script(
			[
				{ type: "message_start", model: "m" },
				{
					type: "tool_call_complete",
					id: "c1",
					name: "add_element",
					input: { action: "add_element", element: { type: "process", name: "Cache" } },
				},
				{ type: "message_stop", stopReason: "tool_use" },
			],
			[
				{ type: "message_start", model: "m" },
				{ type: "text_delta", text: "done" },
				{ type: "message_stop", stopReason: "end_turn" },
			],
		);

		await useAiTurnStore.getState().submitTurn("add a cache", model);
		await flush();

		expect(useAiTurnStore.getState().turn?.phase).toBe("awaiting_approval");
		// Nothing committed while the call is pending — the review gate holds.
		expect(useModelStore.getState().model?.elements.some((e) => e.name === "Cache")).toBe(false);

		applyReviewedProposal();
		await flush();

		const turn = useAiTurnStore.getState().turn;
		expect(turn?.phase).toBe("settled");
		expect(turn?.outcome).toBe("completed");
		expect(useModelStore.getState().model?.elements.some((e) => e.name === "Cache")).toBe(true);

		// One undo reverts the whole turn.
		useAiTurnStore.getState().undoTurn();
		expect(useModelStore.getState().model?.elements.some((e) => e.name === "Cache")).toBe(false);
	});

	it("advertises all 28 tools, read tools included, to the provider", async () => {
		script([
			{ type: "message_start", model: "m" },
			{ type: "text_delta", text: "hi" },
			{ type: "message_stop", stopReason: "end_turn" },
		]);

		await useAiTurnStore.getState().submitTurn("just chatting", model);
		await flush();

		const request: ConversationRequest = streamConversationMock.mock.calls[0][0];
		const advertised = request.tools.map((tool) => tool.name);
		expect(advertised).toHaveLength(28);
		for (const readTool of [
			"get_document_summary",
			"get_entity",
			"search_entities",
			"search_component_catalog",
		]) {
			expect(advertised).toContain(readTool);
		}
		expect(advertised).toContain("reparent_group");
	});

	it("keeps the system prompt bounded and reads an element before and after an approved edit", async () => {
		const large: ThreatModel = {
			...model,
			metadata: { ...model.metadata, description: "private document details ".repeat(5_000) },
			elements: Array.from({ length: 2_000 }, (_, i) => ({
				...model.elements[0],
				id: `large-node-${i}`,
				name: `Existing service ${i}`,
				position: { x: i, y: 20 },
			})),
		};
		const id = "large-node-517";
		useModelStore.getState().setModel(large, null);
		const read = (callId: string): StreamEvent[] => [
			{ type: "message_start", model: "m" },
			{
				type: "tool_call_complete",
				id: callId,
				name: "get_entity",
				input: { kind: "elements", id },
			},
			{ type: "message_stop", stopReason: "tool_use" },
		];
		script(
			read("before"),
			[
				{ type: "message_start", model: "m" },
				{
					type: "tool_call_complete",
					id: "edit",
					name: "update_element",
					input: { action: "update_element", id, updates: { name: "Renamed service" } },
				},
				{ type: "message_stop", stopReason: "tool_use" },
			],
			read("after"),
			[
				{ type: "message_start", model: "m" },
				{ type: "message_stop", stopReason: "end_turn" },
			],
		);

		await useAiTurnStore
			.getState()
			.submitTurn(`Read and rename ${id}, then verify the edit`, large);
		await flush();
		expect(useAiTurnStore.getState().turn?.phase).toBe("awaiting_approval");
		expect(useModelStore.getState().model?.elements[517].name).toBe("Existing service 517");
		applyReviewedProposal();
		await flush();

		expect(useAiTurnStore.getState().turn?.outcome).toBe("completed");
		const requests = streamConversationMock.mock.calls.map(
			([request]) => request as ConversationRequest,
		);
		expect(requests).toHaveLength(4);
		const system = requests[0].system;
		expect(system).toContain(buildSystemPrompt(model, { tools: requests[0].tools }));
		expect(new TextEncoder().encode(system).length).toBeLessThanOrEqual(5 * 1024);
		expect(system).toContain("Document read tools are the authoritative source");
		expect(system).toContain("get_document_summary with layout_offset: 0");
		for (const name of ["get_document_summary", "search_entities", "get_entity"]) {
			expect(system).toContain(name);
		}
		for (const request of requests) {
			expect(request.system).toBe(system);
			for (const documentText of [
				id,
				"Existing service",
				"Renamed service",
				"private document details",
			]) {
				expect(request.system).not.toContain(documentText);
			}
		}
		const resultFor = (request: ConversationRequest, callId: string) =>
			request.messages
				.flatMap((message) => message.content)
				.find((block) => block.type === "tool_result" && block.toolCallId === callId);
		expect(resultFor(requests[1], "before")).toMatchObject({
			content: expect.stringContaining('"name":"Existing service 517"'),
		});
		expect(resultFor(requests[1], "before")).toMatchObject({
			content: expect.stringContaining('"position":{"x":517,"y":20}'),
		});
		expect(resultFor(requests[3], "after")).toMatchObject({
			content: expect.stringContaining('"name":"Renamed service"'),
		});
	});

	it("reports invalid architecture references and discards the entire draft", async () => {
		script(
			[
				{ type: "message_start", model: "m" },
				{
					type: "tool_call_complete",
					id: "add",
					name: "add_group",
					input: { id: "frontend", name: "Frontend" },
				},
				{
					type: "tool_call_complete",
					id: "invalid",
					name: "set_element_group",
					input: { id: "web-app", group: "missing" },
				},
				{
					type: "tool_call_complete",
					id: "delete",
					name: "delete_group",
					input: { id: "frontend" },
				},
				{ type: "message_stop", stopReason: "tool_use" },
			],
			[
				{ type: "message_start", model: "m" },
				{
					type: "tool_call_complete",
					id: "fixed",
					name: "set_element_group",
					input: { id: "web-app", group: "frontend" },
				},
				{ type: "message_stop", stopReason: "tool_use" },
			],
			[
				{ type: "message_start", model: "m" },
				{ type: "text_delta", text: "Done." },
				{ type: "message_stop", stopReason: "end_turn" },
			],
		);
		const before = useModelStore.getState().model;
		await useAiTurnStore.getState().submitTurn("Group the web app", model);
		await flush();
		expect(useModelStore.getState().model).toBe(before);
		const turn = useAiTurnStore.getState();
		const correction: ConversationRequest = streamConversationMock.mock.calls[1][0];
		expect(JSON.stringify(correction.messages)).toContain("missing");
		expect(turn.turn?.proposal).toBeNull();
		expect(turn.turn?.proposalOutcome).toBe("discarded");
		expect(useModelStore.getState().model).toBe(before);
		expect(useHistoryStore.getState().past).toHaveLength(0);
	});
});

describe("submitTurn against a tool-incapable model", () => {
	it("runs a text-only turn with an empty tool set and a fenced prompt", async () => {
		useSettingsStore.setState((state) => ({
			settings: { ...state.settings, aiModelAnthropic: "some-unlisted-model" },
		}));
		script([
			{ type: "message_start", model: "m" },
			{ type: "text_delta", text: "```actions\n[]\n```" },
			{ type: "message_stop", stopReason: "end_turn" },
		]);

		await useAiTurnStore.getState().submitTurn("hello", model);
		await flush();

		const turn = useAiTurnStore.getState().turn;
		expect(turn?.outcome).toBe("completed");
		expect(turn?.toolSet.list()).toHaveLength(0);
		// The request advertised no tools, so preflight allowed the unknown model.
		const request = streamConversationMock.mock.calls[0][0];
		expect(request.tools).toHaveLength(0);
		// The system prompt kept the fenced actions instructions.
		expect(request.system).toContain("```actions");
	});
});

describe("cancelling a live turn", () => {
	it("settles the turn cancelled and commits nothing", async () => {
		script([
			{ type: "message_start", model: "m" },
			{
				type: "tool_call_complete",
				id: "c1",
				name: "add_element",
				input: { action: "add_element", element: { type: "process", name: "Cache" } },
			},
			{ type: "message_stop", stopReason: "tool_use" },
		]);

		await useAiTurnStore.getState().submitTurn("add a cache", model);
		await flush();
		expect(useAiTurnStore.getState().turn?.phase).toBe("awaiting_approval");

		useAiTurnStore.getState().cancelActiveTurn();
		await flush();

		expect(useAiTurnStore.getState().turn?.outcome).toBe("cancelled");
		expect(useModelStore.getState().model?.elements.some((e) => e.name === "Cache")).toBe(false);
	});
});

describe("stopGenerating integration", () => {
	it("is an idempotent no-op when no turn is running", () => {
		// The idle contract document-registry depends on: synchronous, throws nothing.
		expect(() => useChatStore.getState().stopGenerating()).not.toThrow();
		expect(useChatStore.getState().isStreaming).toBe(false);
		expect(useAiTurnStore.getState().turn).toBeNull();
	});

	it("settles a live turn when the chat store cancels", async () => {
		script([
			{ type: "message_start", model: "m" },
			{
				type: "tool_call_complete",
				id: "c1",
				name: "add_element",
				input: { action: "add_element", element: { type: "process", name: "Cache" } },
			},
			{ type: "message_stop", stopReason: "tool_use" },
		]);
		await useAiTurnStore.getState().submitTurn("add a cache", model);
		await flush();

		useChatStore.getState().stopGenerating();
		await flush();

		expect(useAiTurnStore.getState().turn?.outcome).toBe("cancelled");
	});
});

describe("resetTurn clears conversation context", () => {
	const textTurn = (text: string): StreamEvent[] => [
		{ type: "message_start", model: "m" },
		{ type: "text_delta", text },
		{ type: "message_stop", stopReason: "end_turn" },
	];

	it("clears the turn and in-memory history so the next request sends no prior messages", async () => {
		script(textTurn("first reply"), textTurn("second reply"));
		await useAiTurnStore.getState().submitTurn("first question", model);
		await flush();
		expect(useAiTurnStore.getState().turn?.outcome).toBe("completed");

		useAiTurnStore.getState().resetTurn();
		expect(useAiTurnStore.getState().turn).toBeNull();

		await useAiTurnStore.getState().submitTurn("second question", model);
		await flush();

		const calls = streamConversationMock.mock.calls;
		const lastRequest = calls[calls.length - 1][0];
		const texts = lastRequest.messages
			.flatMap((m: { content: Array<{ type: string; text?: string }> }) => m.content)
			.filter((b: { type: string }) => b.type === "text")
			.map((b: { text?: string }) => b.text);
		expect(texts).toContain("second question");
		expect(texts).not.toContain("first question");
		expect(texts).not.toContain("first reply");
	});

	it("carries prior turn context into a follow-up turn when not reset (control)", async () => {
		script(textTurn("first reply"), textTurn("second reply"));
		await useAiTurnStore.getState().submitTurn("first question", model);
		await flush();
		await useAiTurnStore.getState().submitTurn("second question", model);
		await flush();

		const calls = streamConversationMock.mock.calls;
		const lastRequest = calls[calls.length - 1][0];
		const texts = lastRequest.messages
			.flatMap((m: { content: Array<{ type: string; text?: string }> }) => m.content)
			.filter((b: { type: string }) => b.type === "text")
			.map((b: { text?: string }) => b.text);
		// Without a reset, the follow-up continues the conversation.
		expect(texts).toContain("first question");
		expect(texts).toContain("second question");
	});
});

describe("undoAvailability", () => {
	it("is undoable after a committed turn and superseded after a later edit", async () => {
		script(
			[
				{ type: "message_start", model: "m" },
				{
					type: "tool_call_complete",
					id: "c1",
					name: "add_element",
					input: { action: "add_element", element: { type: "process", name: "Cache" } },
				},
				{ type: "message_stop", stopReason: "tool_use" },
			],
			[
				{ type: "message_start", model: "m" },
				{ type: "text_delta", text: "done" },
				{ type: "message_stop", stopReason: "end_turn" },
			],
		);
		await useAiTurnStore.getState().submitTurn("add a cache", model);
		await flush();
		applyReviewedProposal();
		await flush();

		expect(useAiTurnStore.getState().undoAvailability()).toBe("undoable");

		// A later unrelated edit supersedes the turn's single undo entry.
		const current = useModelStore.getState().model;
		if (current) useHistoryStore.getState().pushSnapshot(current);
		expect(useAiTurnStore.getState().undoAvailability()).toBe("superseded");
	});

	it("is already_undone before any turn has run", () => {
		expect(useAiTurnStore.getState().undoAvailability()).toBe("already_undone");
	});
});

describe("native session ownership", () => {
	const reply = (text: string): StreamEvent[] => [
		{ type: "message_start", model: "m" },
		{ type: "text_delta", text },
		{ type: "message_stop", stopReason: "end_turn" },
	];
	it("never lets a restored chat undo another chat's equal-baseline history entry", async () => {
		useChatStore.getState().loadSessionsForFile("/models/undo.thf");
		const first = useChatStore.getState().activeSessionId;
		if (!first) throw new Error("A chat must exist");
		const add = (name: string): StreamEvent[] => [
			{ type: "message_start", model: "m" },
			{
				type: "tool_call_complete",
				id: name,
				name: "add_element",
				input: { action: "add_element", element: { type: "process", name } },
			},
			{ type: "message_stop", stopReason: "tool_use" },
		];
		script(add("Cache"), reply("Cache added"), add("Database"), reply("Database added"));
		await useAiTurnStore.getState().submitTurn("Add cache", model);
		applyReviewedProposal();
		await flush();
		expect(useAiTurnStore.getState().undoAvailability()).toBe("undoable");
		useChatStore.getState().newSession();
		const current = useModelStore.getState().model;
		if (!current) throw new Error("A model must exist");
		const restored = useHistoryStore.getState().undo(current);
		if (!restored) throw new Error("The keyboard Undo path must return a snapshot");
		useModelStore.getState().restoreSnapshot(restored);
		await useAiTurnStore.getState().submitTurn("Add database", restored);
		applyReviewedProposal();
		await flush();
		const secondChatModel = useModelStore.getState().model;
		useChatStore.getState().switchSession(first);
		expect(useAiTurnStore.getState().undoAvailability()).toBe("superseded");
		useAiTurnStore.getState().undoTurn();
		expect(useModelStore.getState().model).toBe(secondChatModel);
		expect(secondChatModel?.elements.map((element) => element.name)).toContain("Database");
	});

	it("restores native messages and tool pairing as context only for their selected session", async () => {
		localStorage.clear();
		useChatStore.getState().loadSessionsForFile("/models/a.thf");
		const first = useChatStore.getState().activeSessionId;
		if (!first) throw new Error("A chat must exist");
		script(
			[
				{ type: "message_start", model: "m" },
				{
					type: "tool_call_complete",
					id: "c1",
					name: "add_element",
					input: { action: "add_element", element: { type: "process", name: "Cache" } },
				},
				{ type: "message_stop", stopReason: "tool_use" },
			],
			reply("Cache added"),
			reply("Separate database review"),
			reply("Continuing cache review"),
		);
		await useAiTurnStore.getState().submitTurn("Review the cache", model);
		applyReviewedProposal();
		await flush();
		expect(useChatStore.getState().sessions[0].title).toBe("Review the cache");
		expect(
			useChatStore.getState().messages.some((m) => m.content.some((b) => b.type === "tool_result")),
		).toBe(true);
		useChatStore.getState().newSession();
		expect(useAiTurnStore.getState().turn).toBeNull();
		await useAiTurnStore.getState().submitTurn("Review database", model);
		useChatStore.getState().switchSession(first);
		expect(useAiTurnStore.getState().turn?.messages).toEqual(useChatStore.getState().messages);
		await useAiTurnStore.getState().submitTurn("Continue", model);
		const request: ConversationRequest = streamConversationMock.mock.calls[3][0];
		expect(JSON.stringify(request.messages)).toContain("Cache added");
		expect(JSON.stringify(request.messages)).not.toContain("Separate database review");
		const blocks = request.messages.flatMap((m) => m.content);
		expect(blocks.filter((b) => b.type === "tool_call")).toHaveLength(1);
		expect(blocks.filter((b) => b.type === "tool_result")).toHaveLength(1);
	});

	it("switching a pending approval settles it without allowing a mutation in the new chat", async () => {
		localStorage.clear();
		useChatStore.getState().loadSessionsForFile("/models/b.thf");
		const first = useChatStore.getState().activeSessionId;
		if (!first) throw new Error("A chat must exist");
		script([
			{ type: "message_start", model: "m" },
			{
				type: "tool_call_complete",
				id: "c1",
				name: "add_element",
				input: { action: "add_element", element: { type: "process", name: "Cache" } },
			},
			{ type: "message_stop", stopReason: "tool_use" },
		]);
		await useAiTurnStore.getState().submitTurn("Add cache", model);
		const token = useAiTurnStore.getState().turn?.proposal?.token;
		if (!token) throw new Error("Expected a proposal before switching chats");
		useChatStore.getState().newSession();
		useAiTurnStore.getState().applyProposal(token);
		await flush();
		expect(useModelStore.getState().model?.elements).toHaveLength(1);
		useChatStore.getState().switchSession(first);
		expect(useAiTurnStore.getState().turn?.outcome).toBe("cancelled");
		expect(useAiTurnStore.getState().turn?.calls[0].status).toBe("denied");
	});

	it("ignores delayed outgoing stream events after a session switch and new response", async () => {
		localStorage.clear();
		useChatStore.getState().loadSessionsForFile("/models/late.thf");
		let oldHandlers: StreamConversationHandlers | undefined;
		let finishOld: (() => void) | undefined;
		streamConversationMock
			.mockImplementationOnce(async (_r, _t, handlers: StreamConversationHandlers) => {
				oldHandlers = handlers;
				handlers.onEvent({ type: "message_start", model: "m" });
				handlers.onEvent({ type: "text_delta", text: "Retained partial answer" });
				await new Promise<void>((resolve) => {
					finishOld = resolve;
				});
			})
			.mockImplementationOnce(async (_r, _t, handlers: StreamConversationHandlers) => {
				for (const event of reply("New session answer")) handlers.onEvent(event);
			});
		const pending = useAiTurnStore.getState().submitTurn("Old question", model);
		await flush();
		const oldId = useChatStore.getState().activeSessionId;
		useChatStore.getState().newSession();
		await useAiTurnStore.getState().submitTurn("New question", model);
		oldHandlers?.onEvent({ type: "text_delta", text: "LATE OUTGOING TEXT" });
		finishOld?.();
		await pending;
		expect(JSON.stringify(useChatStore.getState().messages)).toContain("New session answer");
		expect(JSON.stringify(useChatStore.getState().messages)).not.toContain("LATE OUTGOING TEXT");
		if (!oldId) throw new Error("A chat must exist");
		useChatStore.getState().switchSession(oldId);
		expect(JSON.stringify(useChatStore.getState().messages)).toContain("Retained partial answer");
		expect(JSON.stringify(useChatStore.getState().messages)).not.toContain("LATE OUTGOING TEXT");
	});
});

it("retains separate tool status and Undo for tabs sharing a persisted session id", async () => {
	localStorage.clear();
	const registry = useDocumentRegistry.getState();
	const a = registry.createDocument({
		model: structuredClone(model),
		filePath: "/shared.thf",
		pendingLayout: null,
	});
	const session = useChatStore.getState().activeSessionId;
	if (!session) throw new Error("A chat must exist");
	useChatStore
		.getState()
		.recordTurn(
			session,
			[{ role: "user", content: [{ type: "text", text: "Shared introduction" }] }],
			true,
		);
	const b = registry.createDocument({
		model: structuredClone(model),
		filePath: "/shared.thf",
		pendingLayout: null,
	});
	expect(useChatStore.getState().activeSessionId).toBe(session);
	registry.activateDocument(a);
	script(
		[
			{ type: "message_start", model: "m" },
			{
				type: "tool_call_complete",
				id: "cache",
				name: "add_element",
				input: { action: "add_element", element: { type: "process", name: "Cache" } },
			},
			{ type: "message_stop", stopReason: "tool_use" },
		],
		[
			{ type: "message_start", model: "m" },
			{ type: "text_delta", text: "Added Cache" },
			{ type: "message_stop", stopReason: "end_turn" },
		],
		[
			{ type: "message_start", model: "m" },
			{ type: "text_delta", text: "B's independent answer" },
			{ type: "message_stop", stopReason: "end_turn" },
		],
	);
	await useAiTurnStore.getState().submitTurn("Add Cache", model);
	applyReviewedProposal();
	await flush();
	const aTurn = useAiTurnStore.getState().turn;
	expect(aTurn?.calls[0].status).toBe("succeeded");
	registry.activateDocument(b);
	await useAiTurnStore.getState().submitTurn("Review B", model);
	registry.activateDocument(a);
	expect(useAiTurnStore.getState().turn).toBe(aTurn);
	expect(useAiTurnStore.getState().undoAvailability()).toBe("undoable");
	registry.closeDocument(b);
	expect(useAiTurnStore.getState().turn).toBe(aTurn);
	useAiTurnStore.getState().undoTurn();
	expect(useModelStore.getState().model?.elements.some((element) => element.name === "Cache")).toBe(
		false,
	);
});
