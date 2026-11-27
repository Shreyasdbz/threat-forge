import type { ThreatModel } from "@/types/threat-model";

export type ActionIdKind = "element" | "flow" | "boundary" | "threat";
export type AllocateActionId = (kind: ActionIdKind) => string;

export function createProposalIdReservations(
	baseline: ThreatModel,
): (document?: ThreatModel) => AllocateActionId {
	const occupied = (kind: ActionIdKind, model: ThreatModel): readonly { id: string }[] => {
		switch (kind) {
			case "element":
				return [...model.elements, ...(model.groups ?? [])];
			case "flow":
				return [...model.data_flows, ...(model.relationships ?? [])];
			case "boundary":
				return [...model.trust_boundaries, ...(model.groups ?? [])];
			case "threat":
				return model.threats;
		}
	};
	const sequence = (prefix: string, entities: readonly { id: string }[]) => ({
		prefix,
		used: new Set(entities.map(({ id }) => id)),
		next: 1,
	});
	const sequences = {
		element: sequence("comp", occupied("element", baseline)),
		flow: sequence("flow", occupied("flow", baseline)),
		boundary: sequence("boundary", occupied("boundary", baseline)),
		threat: sequence("threat", baseline.threats),
	};

	return (document = baseline) => {
		const reserved = new Map<ActionIdKind, string>();
		return (kind) => {
			const previous = reserved.get(kind);
			if (previous !== undefined) return previous;
			const { prefix, used } = sequences[kind];
			const current = new Set(occupied(kind, document).map(({ id }) => id));
			let id: string;
			do {
				id = `${prefix}-${sequences[kind].next++}`;
			} while (used.has(id) || current.has(id));
			used.add(id);
			reserved.set(kind, id);
			return id;
		};
	};
}
