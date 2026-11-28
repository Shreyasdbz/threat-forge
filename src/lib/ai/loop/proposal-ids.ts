import type { ThreatModel } from "@/types/threat-model";

export type ActionIdKind = "element" | "flow" | "boundary" | "threat";
export type AllocateActionId = (kind: ActionIdKind) => string;

export function createProposalIdReservations(
	baseline: ThreatModel,
	saved?: ThreatModel,
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
	const sequence = (prefix: string, kind: ActionIdKind) => ({
		prefix,
		used: new Set([
			...occupied(kind, baseline).map(({ id }) => id),
			...(saved ? occupied(kind, saved).map(({ id }) => id) : []),
		]),
		next: 1,
	});
	const sequences = {
		element: sequence("comp", "element"),
		flow: sequence("flow", "flow"),
		boundary: sequence("boundary", "boundary"),
		threat: sequence("threat", "threat"),
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
