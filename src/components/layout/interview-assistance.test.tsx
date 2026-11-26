import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { streamConversation } from "@/lib/ai/protocol/client";
import { InterviewAssistance } from "./interview-assistance";

const { hasKey } = vi.hoisted(() => ({ hasKey: vi.fn() }));
vi.mock("@/lib/adapters/get-keychain-adapter", () => ({
	getKeychainAdapter: async () => ({ hasKey }),
}));
vi.mock("@/lib/adapters/get-chat-transport", () => ({ getChatTransport: async () => ({}) }));
vi.mock("@/lib/ai/protocol/client", () => ({ streamConversation: vi.fn() }));

const stream = vi.mocked(streamConversation);
const answers = {
	scope: "Online checkout",
	assets: "Private inventory",
	elements: [],
	flows: [],
	boundaries: { definitions: [], memberOf: {} },
};

beforeEach(() => {
	hasKey.mockReset().mockResolvedValue(true);
	stream.mockReset();
});
afterEach(cleanup);

function openConsent(stillCurrent = () => true) {
	render(<InterviewAssistance answers={answers} stillCurrent={stillCurrent} />);
	fireEvent.click(screen.getByRole("button", { name: "Optional AI follow-up" }));
	expect(screen.getByRole("checkbox", { name: "Trust boundaries" })).toBeDisabled();
	const send = screen.getByRole("button", { name: /^Send selected answers to / });
	expect(send).toBeDisabled();
	fireEvent.click(screen.getByRole("checkbox", { name: "System scope" }));
	expect(hasKey).not.toHaveBeenCalled();
	expect(stream).not.toHaveBeenCalled();
	return send;
}

it("sends only confirmed answers through BYOK and shows inert validated questions", async () => {
	stream.mockImplementation(async (request, _transport, { onEvent }) => {
		expect(request.provider).toBe("anthropic");
		expect(request.messages).toEqual([
			{ role: "user", content: [{ type: "text", text: '{"scope":"Online checkout"}' }] },
		]);
		expect(request.tools).toEqual([]);
		onEvent({ type: "text_delta", text: '{"questions":["Where is the payment data stored?"]}' });
		onEvent({ type: "message_stop", stopReason: "end_turn" });
	});
	fireEvent.click(openConsent());
	expect(await screen.findByText("Where is the payment data stored?")).toBeInTheDocument();
});

it("refuses a missing key without contacting the provider", async () => {
	hasKey.mockResolvedValue(false);
	fireEvent.click(openConsent());
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No API key"));
	expect(stream).not.toHaveBeenCalled();
});

it("refuses a stale draft without contacting the provider", async () => {
	fireEvent.click(openConsent(() => false));
	expect(screen.getByRole("status")).toHaveTextContent("draft is no longer current");
	expect(hasKey).not.toHaveBeenCalled();
	expect(stream).not.toHaveBeenCalled();
});

it("rejects malformed suggestions and still allows offline review", async () => {
	stream.mockImplementation(async (_request, _transport, { onEvent }) => {
		onEvent({ type: "text_delta", text: '{"questions":["Follow up"],"mutations":[{"id":"x"}]}' });
		onEvent({ type: "message_stop", stopReason: "end_turn" });
	});
	fireEvent.click(openConsent());
	await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("did not return valid"));
	expect(screen.queryByText("Follow up")).not.toBeInTheDocument();
	expect(screen.getByRole("checkbox", { name: "System scope" })).toBeEnabled();
});

it("cancels the provider request and ignores late output", async () => {
	let signal: AbortSignal | undefined;
	let finish: (() => void) | undefined;
	stream.mockImplementation(async (_request, _transport, { onEvent }, activeSignal) => {
		signal = activeSignal;
		await new Promise<void>((resolve) => {
			finish = () => {
				onEvent({ type: "text_delta", text: '{"questions":["Late result"]}' });
				onEvent({ type: "message_stop", stopReason: "end_turn" });
				resolve();
			};
		});
	});
	fireEvent.click(openConsent());
	await waitFor(() => expect(signal).toBeDefined());
	fireEvent.click(screen.getByRole("button", { name: "Cancel AI request" }));
	expect(signal?.aborted).toBe(true);
	finish?.();
	expect(screen.getByRole("status")).toHaveTextContent("Request cancelled");
	expect(screen.queryByText("Late result")).not.toBeInTheDocument();
	expect(screen.getByRole("checkbox", { name: "System scope" })).toBeEnabled();
});
