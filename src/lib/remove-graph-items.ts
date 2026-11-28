import type { ThreatModel } from "@/types/threat-model";

export function removeGraphItems(
	model: ThreatModel,
	targets: {
		elements?: ReadonlySet<string>;
		boundaries?: ReadonlySet<string>;
		flows?: ReadonlySet<string>;
	},
): ThreatModel {
	const { elements, boundaries, flows } = targets;
	const removedFlows = new Set(flows);
	for (const flow of model.data_flows) {
		if (elements?.has(flow.from) || elements?.has(flow.to)) removedFlows.add(flow.id);
	}
	return {
		...model,
		elements: model.elements.filter((element) => !elements?.has(element.id)),
		data_flows: model.data_flows.filter((flow) => !removedFlows.has(flow.id)),
		...(model.relationships && {
			relationships: model.relationships.filter(
				(relationship) => !elements?.has(relationship.from) && !elements?.has(relationship.to),
			),
		}),
		trust_boundaries: model.trust_boundaries
			.filter((boundary) => !boundaries?.has(boundary.id))
			.map((boundary) => ({
				...boundary,
				contains: boundary.contains.filter((id) => !elements?.has(id)),
			})),
		threats: model.threats.filter(
			(threat) =>
				!(threat.element && elements?.has(threat.element)) &&
				!(threat.flow && removedFlows.has(threat.flow)),
		),
	};
}
