import type { ThreatModel } from "@/types/threat-model";

export function removeGraphItems(
	model: ThreatModel,
	nodeIds: ReadonlySet<string>,
	flowIds: ReadonlySet<string>,
): ThreatModel {
	const removedFlows = new Set(flowIds);
	for (const flow of model.data_flows) {
		if (nodeIds.has(flow.from) || nodeIds.has(flow.to)) removedFlows.add(flow.id);
	}
	return {
		...model,
		elements: model.elements.filter((element) => !nodeIds.has(element.id)),
		data_flows: model.data_flows.filter((flow) => !removedFlows.has(flow.id)),
		...(model.relationships && {
			relationships: model.relationships.filter(
				(relationship) => !nodeIds.has(relationship.from) && !nodeIds.has(relationship.to),
			),
		}),
		trust_boundaries: model.trust_boundaries
			.filter((boundary) => !nodeIds.has(boundary.id))
			.map((boundary) => ({
				...boundary,
				contains: boundary.contains.filter((id) => !nodeIds.has(id)),
			})),
		threats: model.threats.filter(
			(threat) =>
				!(threat.element && nodeIds.has(threat.element)) &&
				!(threat.flow && removedFlows.has(threat.flow)),
		),
	};
}
