/**
 * The turn runner: the effect layer that drives the pure reducer.
 *
 * It performs exactly four kinds of effect and holds no policy:
 *
 *  1. issue a provider request (per iteration, so budgeting re-runs as history grows);
 *  2. dispatch stream events into the reducer;
 *  3. execute the calls the reducer moved to `running`;
 *  4. review staged changes and commit through the transaction module.
 *
 * It cannot execute a call the reducer refused: it only *asks* to start a call
 * (`startCall`), runs it when the reducer answered `running`, and discards an
 * in-flight outcome if the turn was cancelled while it ran — which is complete,
 * because tools return documents rather than mutating, so there is nothing to
 * roll back.
 *
 * `drive()` runs the turn to its next rest point (an approval pause or
 * settlement); a user command resumes it.
 */

import type { ConversationRequest } from "@/lib/ai/protocol/client";
import type { ProtocolError } from "@/lib/ai/protocol/errors";
import type { StreamEvent } from "@/lib/ai/protocol/events";
import type { AiProvider, ProtocolMessage } from "@/lib/ai/protocol/messages";
import { type DocumentStores, getActiveStores } from "@/stores/document-stores";
import type { ThreatModel } from "@/types/threat-model";
import { budgetExhaustion, type TurnLimits } from "./limits";
import type { ToolOutcome, ToolRegistry } from "./tool-runtime";
import {
	commitToolOutcome,
	createTurnUndoLedger,
	turnUndoAvailability,
	type UndoAvailability,
	undoTurn as undoTurnTransaction,
} from "./transaction";
import {
	createIdleTurnState,
	type ProposalOutcome,
	reduceTurn,
	runnableCalls,
	type TurnInput,
	type TurnState,
} from "./turn-machine";
import { createTurnProposal } from "./turn-proposal";

/** Everything a single turn needs that does not change across its iterations. */
export interface TurnConfig {
	text: string;
	baseMessages: readonly ProtocolMessage[];
	provider: AiProvider;
	modelId: string;
	system: string;
	/** The frozen tool set; empty runs a text-only (fenced) turn. */
	toolSet: ToolRegistry;
	limits: TurnLimits;
	maxOutputTokens: number;
}

/**
 * The effectful collaborators. `stream` and `getDocument` differ between the
 * store (real) and tests (a scripted fake), so they are injected; commit, undo,
 * and the clock are the real implementations everywhere and are imported
 * directly rather than threaded as seams.
 */
export interface TurnRunnerDeps {
	/** Open a provider stream, dispatching each event, resolving at the terminal event. */
	stream: (
		request: ConversationRequest,
		onEvent: (event: StreamEvent) => void,
		signal: AbortSignal,
	) => Promise<void>;
	/** Read the live document immediately before a call runs. */
	getDocument: () => ThreatModel | null;
	reviewProposals?: boolean;
	ownsDocument?: () => boolean;
	/** Notified after every state change so a store can mirror it. */
	onState?: (state: TurnState) => void;
}

/** Only these codes are worth a turn-level retry; they mirror the transport's transient split. */
function isTurnRetriable(code: ProtocolError["code"]): boolean {
	return code === "rate_limited" || code === "transport";
}

function stagedResult(result: string): string {
	try {
		const value: unknown = JSON.parse(result);
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			return JSON.stringify({ ...value, status: "staged" });
		}
	} catch {
		// Existing mutation tools also return plain-text results.
	}
	return JSON.stringify({ status: "staged", result });
}

export interface TurnRunner {
	getState(): TurnState;
	/** Whether the settled turn's single undo entry is still at the top of the history stack. */
	undoAvailability(): UndoAvailability;
	/** Each command returns the drive promise, which resolves at the next approval pause or settlement. */
	submit(config: TurnConfig): Promise<void>;
	approveCall(id: string): Promise<void>;
	approveBatch(ids: readonly string[]): Promise<void>;
	denyCall(id: string): Promise<void>;
	selectProposal(token: symbol, selected: readonly string[]): Promise<void>;
	applyProposal(token: symbol): void;
	rejectProposal(token: symbol): void;
	cancel(): void;
	undo(): void;
}

/** Create a runner bound to one live turn. */
export function createTurnRunner(deps: TurnRunnerDeps): TurnRunner {
	const commit = commitToolOutcome;
	const undoTurn = undoTurnTransaction;
	const now = () => Date.now();

	let state = createIdleTurnState();
	let config: TurnConfig | null = null;
	let controller: AbortController | null = null;
	let ledger = createTurnUndoLedger();
	let driving = false;
	let proposal: ReturnType<typeof createTurnProposal> | null = null;
	let baseline: {
		stores: DocumentStores;
		model: ThreatModel;
		filePath: string | null;
		fileRevision?: string;
	} | null = null;

	function setState(next: TurnState): void {
		state = next;
		deps.onState?.(state);
	}

	function dispatch(input: TurnInput): void {
		const next = reduceTurn(
			state,
			input,
			input.type === "tool_call_complete" && !deps.reviewProposals ? deps.getDocument() : undefined,
		);
		if (proposal && next.phase === "settled" && state.phase !== "settled") {
			if (
				input.type === "message_stop" &&
				(input.stopReason === "end_turn" || input.stopReason === "stop_sequence")
			) {
				setState({ ...next, phase: "preparing_review", outcome: null });
				return;
			}
			if (state.proposal || next.calls.some((call) => call.effect === "mutate")) {
				settleProposal("discarded", next);
				return;
			}
			proposal = null;
		}
		setState(next);
	}

	function baselineIsCurrent(): boolean {
		if (!baseline || getActiveStores() !== baseline.stores || deps.ownsDocument?.() === false) {
			return false;
		}
		const { filePath, fileRevision, fileSync } = baseline.stores.model.getState();
		return (
			deps.getDocument() === baseline.model &&
			filePath === baseline.filePath &&
			fileRevision === baseline.fileRevision &&
			fileSync !== "conflict"
		);
	}

	function settleProposal(
		outcome: ProposalOutcome,
		next = state,
		selected: ReadonlySet<string> = new Set(),
	): void {
		proposal = null;
		baseline = null;
		const applied: { call_id: string; tool: string }[] = [];
		const excluded: typeof applied = [];
		for (const call of next.calls) {
			if (call.effect !== "mutate" || call.status !== "succeeded") continue;
			(selected.has(call.id) ? applied : excluded).push({ call_id: call.id, tool: call.toolName });
		}
		const text = JSON.stringify({
			proposal_status: outcome,
			applied,
			excluded,
		});
		const result: ProtocolMessage = {
			role: "assistant",
			origin: "proposal",
			content: [{ type: "text", text }],
		};
		setState({
			...next,
			phase: "settled",
			outcome: next.outcome ?? "completed",
			proposal: null,
			updatingProposal: false,
			proposalOutcome: outcome,
			messages: [...next.messages, result],
			calls: next.calls.map((call) =>
				call.effect === "mutate" && call.status === "succeeded" && !selected.has(call.id)
					? { ...call, status: "denied", result: "Not applied." }
					: call,
			),
		});
	}

	function finishReview(): void {
		if (state.calls.some((call) => call.status === "failed" || call.status === "denied")) {
			settleProposal("discarded");
			return;
		}
		const review = proposal?.finish();
		if (!review) {
			proposal = null;
			baseline = null;
			setState({ ...state, phase: "settled", outcome: "completed" });
		} else if (!baselineIsCurrent()) {
			settleProposal("stale");
		} else if (review.changes.length === 0) {
			settleProposal("unchanged");
		} else {
			setState({ ...state, phase: "awaiting_approval", proposal: review });
		}
	}

	function signal(): AbortSignal {
		// A controller always exists once a turn has started; the fallback keeps the
		// type honest for the idle window before `submit`.
		return controller?.signal ?? AbortSignal.abort();
	}

	function buildRequest(cfg: TurnConfig): ConversationRequest {
		return {
			provider: cfg.provider,
			modelId: cfg.modelId,
			system: proposal
				? `${cfg.system}\n\nMutation tools stage changes in a private draft. Read tools report the draft, including staged edits. Until the user applies the proposal, no live document edits have been made. Summarize proposed changes without claiming they were applied.`
				: cfg.system,
			// The full turn history; `streamConversation` budgets it every iteration.
			messages: state.messages,
			tools: cfg.toolSet.list(),
			maxOutputTokens: cfg.maxOutputTokens,
		};
	}

	/** Drive the turn to its next rest point: an approval pause or settlement. */
	async function drive(): Promise<void> {
		if (driving) return;
		driving = true;
		try {
			for (;;) {
				if (state.phase === "requesting") {
					await runStream();
					continue;
				}
				if (state.phase === "awaiting_approval" && proposal && !state.proposal) {
					dispatch({ type: "stageMutations" });
					continue;
				}
				if (state.phase === "preparing_review") {
					finishReview();
					return;
				}
				if (state.phase === "executing") {
					if (runnableCalls(state).length > 0) {
						await runExecution();
					} else {
						// Nothing left to run this iteration; progress the loop with the clock.
						dispatch({ type: "advance", nowMs: now() });
					}
					continue;
				}
				return; // awaiting_approval, settled, idle, or streaming (transient)
			}
		} finally {
			driving = false;
		}
	}

	/** Open one provider request, holding a transient pre-content failure for a bounded retry. */
	async function runStream(): Promise<void> {
		if (config === null) return;
		for (;;) {
			let producedContent = false;
			let heldError: ProtocolError | undefined;

			await deps.stream(
				buildRequest(config),
				(event) => {
					if (event.type === "error" && !producedContent && isTurnRetriable(event.error.code)) {
						// Hold a transient failure that arrived before any output, so a replay
						// cannot duplicate content the consumer already saw.
						heldError = event.error;
						return;
					}
					if (event.type !== "aborted" && event.type !== "error") producedContent = true;
					dispatch(event);
				},
				signal(),
			);

			if (heldError === undefined) return;
			if (signal().aborted) {
				dispatch({ type: "cancel" });
				return;
			}
			// Retry only while the turn budget allows; otherwise surface the failure.
			if (budgetExhaustion(state.budget, config.limits, now()) !== null) {
				dispatch({ type: "error", error: heldError });
				return;
			}
			dispatch({ type: "retry" });
		}
	}

	/** Execute every approved call of the current iteration, committing each outcome. */
	async function runExecution(): Promise<void> {
		for (const call of runnableCalls(state)) {
			if (signal().aborted) return;

			dispatch({ type: "startCall", callId: call.id });
			// Proceed only if the reducer authorized the start.
			if (state.calls.find((c) => c.id === call.id)?.status !== "running") continue;

			const prepared = call.prepared;
			const document = proposal?.getDocument() ?? deps.getDocument();
			if (prepared === null || document === null) {
				dispatch({
					type: "callSettled",
					callId: call.id,
					outcome: { status: "error", result: "No document is open to apply this change to." },
				});
				continue;
			}

			let outcome: ToolOutcome;
			if (proposal) {
				const tool = config?.toolSet.get(call.toolName);
				outcome = tool
					? await proposal.run(tool, call.id, prepared, signal())
					: { status: "error", result: "This tool is not available in the turn." };
				if (signal().aborted) return;
				if (outcome.status === "ok" && call.effect === "mutate") {
					outcome = {
						status: "ok",
						result: stagedResult(outcome.result),
					};
				}
				dispatch({ type: "callSettled", callId: call.id, outcome });
				continue;
			}
			try {
				outcome = await prepared.run({ document, signal: signal() });
			} catch {
				outcome = { status: "error", result: "The tool failed while running." };
			}

			// A stop that fired while the call ran discards the outcome — nothing was
			// committed, so there is nothing to roll back.
			if (signal().aborted) return;

			const committed = commit(outcome, { expected: document, effect: call.effect, ledger });
			const settled: ToolOutcome =
				committed.status === "refused"
					? { status: "error", result: committed.result }
					: { status: "ok", result: committed.result };
			dispatch({ type: "callSettled", callId: call.id, outcome: settled });
		}
	}

	return {
		getState: () => state,
		undoAvailability: () => turnUndoAvailability(ledger),

		submit(cfg) {
			if (state.phase !== "idle" && state.phase !== "settled") return Promise.resolve();
			config = cfg;
			ledger = createTurnUndoLedger();
			controller = new AbortController();
			const model = deps.getDocument();
			const stores = getActiveStores();
			const { filePath, fileRevision } = stores.model.getState();
			baseline = deps.reviewProposals && model ? { stores, model, filePath, fileRevision } : null;
			proposal = baseline ? createTurnProposal(baseline.model) : null;
			dispatch({
				type: "submit",
				text: cfg.text,
				baseMessages: cfg.baseMessages,
				toolSet: cfg.toolSet,
				limits: cfg.limits,
				nowMs: now(),
			});
			if (deps.reviewProposals && !proposal) {
				settleProposal("stale");
				return Promise.resolve();
			}
			return drive();
		},

		approveCall(id) {
			if (deps.reviewProposals) return Promise.resolve();
			dispatch({ type: "approveCall", callId: id });
			return drive();
		},

		approveBatch(ids) {
			if (deps.reviewProposals) return Promise.resolve();
			dispatch({ type: "approveBatch", callIds: ids });
			return drive();
		},

		denyCall(id) {
			if (deps.reviewProposals) return Promise.resolve();
			dispatch({ type: "denyCall", callId: id });
			return drive();
		},

		async selectProposal(token, selected) {
			if (!proposal || state.proposal?.token !== token || state.updatingProposal) return;
			if (!baselineIsCurrent()) {
				settleProposal("stale");
				return;
			}
			const draft = proposal;
			const reviewSignal = signal();
			setState({ ...state, updatingProposal: true });
			const review = await draft.select(token, new Set(selected), reviewSignal);
			if (!review || reviewSignal.aborted || state.proposal?.token !== token) return;
			if (!baselineIsCurrent()) {
				settleProposal("stale");
				return;
			}
			setState({ ...state, proposal: review, updatingProposal: false });
		},

		applyProposal(token) {
			const review = state.proposal;
			if (!proposal || !baseline || review?.token !== token || state.updatingProposal) return;
			if (!baselineIsCurrent()) {
				settleProposal("stale");
				return;
			}
			const candidate = proposal.take(token);
			if (!candidate) return;
			const applied = commit(
				{ status: "ok", document: candidate, result: "Applied the reviewed proposal." },
				{ expected: baseline.model, effect: "mutate", ledger },
				baseline.stores,
			);
			settleProposal(
				applied.status === "committed" ? "applied" : "discarded",
				state,
				applied.status === "committed"
					? new Set(review.operations.filter(({ included }) => included).map(({ id }) => id))
					: undefined,
			);
		},

		rejectProposal(token) {
			if (proposal && state.proposal?.token === token) settleProposal("rejected");
		},

		cancel() {
			// Abort first so an in-flight tool run discards its outcome, then settle.
			controller?.abort();
			dispatch({ type: "cancel" });
		},

		undo() {
			if (state.phase !== "settled") return;
			if (undoTurn(ledger)) dispatch({ type: "undoTurn" });
		},
	};
}
