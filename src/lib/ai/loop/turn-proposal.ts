import type { ThreatModel } from "@/types/threat-model";
import { diffProposal, type ProposalChange } from "./proposal-diff";
import { type AllocateActionId, createProposalIdReservations } from "./proposal-ids";
import type { PreparedCall, RegisteredTool, ToolOutcome } from "./tool-runtime";
import { proposedDocumentError } from "./transaction";

export interface ProposalOperation {
	id: string;
	summary: string;
	included: boolean;
}

export interface ProposalReview {
	token: symbol;
	operations: ProposalOperation[];
	changes: ProposalChange[];
	blocked: { operation: string; reason: string } | null;
}

interface StagedOperation {
	id: string;
	call: PreparedCall;
	allocateId: AllocateActionId;
}

interface ReviewedCandidate {
	token: symbol;
	document: ThreatModel | null;
}

async function runMutation(
	operation: StagedOperation,
	document: ThreatModel,
	signal: AbortSignal,
): Promise<ToolOutcome> {
	try {
		const result = await operation.call.run({ document, signal, allocateId: operation.allocateId });
		if (result.status === "ok" && result.document) {
			const error = proposedDocumentError(result.document);
			if (error !== null) return { status: "error", result: error };
		}
		return result;
	} catch {
		return { status: "error", result: "The proposed operation failed." };
	}
}

export function createTurnProposal(baseline: ThreatModel, saved?: ThreatModel) {
	const privateBaseline = structuredClone(baseline);
	const reserve = createProposalIdReservations(privateBaseline, saved);
	const operations: StagedOperation[] = [];
	let draft = privateBaseline;
	let reviewed: ReviewedCandidate | null = null;
	let finished = false;

	function publish(
		selected: ReadonlySet<string>,
		document: ThreatModel | null,
		blocked: ProposalReview["blocked"] = null,
	): ProposalReview {
		const view: ProposalReview = {
			token: Symbol(),
			operations: operations.map(({ id, call }) => ({
				id,
				summary: call.summary,
				included: selected.has(id),
			})),
			changes: document ? structuredClone(diffProposal(privateBaseline, document)) : [],
			blocked,
		};
		reviewed = { token: view.token, document: view.changes.length ? document : null };
		return view;
	}

	return {
		getDocument: () => draft,
		async run(
			tool: RegisteredTool,
			id: string,
			call: PreparedCall,
			signal: AbortSignal,
		): Promise<ToolOutcome> {
			if (finished || signal.aborted) {
				return { status: "error", result: "The proposal is not accepting operations." };
			}
			if (tool.effect === "read" && !tool.destructive) {
				try {
					const result = await call.run({ document: draft, signal });
					return result.status === "ok" && result.document
						? { status: "error", result: "A read-only tool returned a document change." }
						: result;
				} catch {
					return { status: "error", result: "The read tool failed." };
				}
			}
			if (tool.effect !== "mutate" || tool.stageable !== true) {
				return { status: "error", result: "This tool cannot stage a document change." };
			}
			const operation = { id, call, allocateId: reserve(draft) };
			const result = await runMutation(operation, draft, signal);
			if (signal.aborted) return { status: "error", result: "The proposal was cancelled." };
			if (result.status === "error") return result;
			if (result.document) {
				draft = result.document;
				operations.push(operation);
			}
			return result;
		},
		finish(): ProposalReview | null {
			if (finished) return null;
			finished = true;
			if (operations.length === 0) return null;
			return publish(new Set(operations.map(({ id }) => id)), draft);
		},
		async select(
			token: symbol,
			selected: ReadonlySet<string>,
			signal: AbortSignal,
		): Promise<ProposalReview | null> {
			if (reviewed?.token !== token) return null;
			reviewed = null;
			let candidate = privateBaseline;
			for (const operation of operations) {
				if (signal.aborted) return null;
				if (!selected.has(operation.id)) continue;
				const result = await runMutation(operation, candidate, signal);
				if (signal.aborted) return null;
				if (result.status === "error") {
					return publish(selected, null, {
						operation: operation.call.summary,
						reason: result.result,
					});
				}
				if (result.document) candidate = result.document;
			}
			return publish(selected, candidate);
		},
		take(token: symbol): ThreatModel | null {
			if (reviewed?.token !== token || !reviewed.document) return null;
			const { document } = reviewed;
			reviewed = null;
			return document;
		},
	};
}
