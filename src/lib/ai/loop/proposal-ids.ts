import type { ThreatModel } from "@/types/threat-model";

export type ActionIdKind = "element" | "flow" | "boundary" | "threat";
export type AllocateActionId = (kind: ActionIdKind) => string;

export function createProposalIdReservations(baseline: ThreatModel): () => AllocateActionId {
	const sequence = (prefix: string, entities: readonly { id: string }[]) => ({
		prefix,
		used: new Set(entities.map(({ id }) => id)),
		next: 1,
	});
	const sequences = {
		element: sequence("comp", baseline.elements),
		flow: sequence("flow", baseline.data_flows),
		boundary: sequence("boundary", baseline.trust_boundaries),
		threat: sequence("threat", baseline.threats),
	};

	return () => {
		const reserved = new Map<ActionIdKind, string>();
		return (kind) => {
			const previous = reserved.get(kind);
			if (previous !== undefined) return previous;
			const { prefix, used } = sequences[kind];
			let id: string;
			do {
				id = `${prefix}-${sequences[kind].next++}`;
			} while (used.has(id));
			used.add(id);
			reserved.set(kind, id);
			return id;
		};
	};
}
