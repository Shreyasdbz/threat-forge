import { Button } from "@/components/ui/button";
import { requestGraphDeletion } from "@/lib/request-graph-deletion";
import { useModelStore } from "@/stores/model-store";
import { EdgeProperties } from "./properties/edge-properties";
import { ElementProperties } from "./properties/element-properties";
import { TrustBoundaryProperties } from "./properties/trust-boundary-properties";

export function PropertiesTab() {
	const selectedElementId = useModelStore((s) => s.selectedElementId);
	const selectedEdgeId = useModelStore((s) => s.selectedEdgeId);
	const selectedBoundaryId = useModelStore((s) => s.selectedBoundaryId);
	const model = useModelStore((s) => s.model);

	if (!model) {
		return <p className="text-editor-caption text-muted-foreground">No model open.</p>;
	}

	if (selectedEdgeId) {
		const flow = model.data_flows.find((f) => f.id === selectedEdgeId);
		if (!flow) {
			return <p className="text-editor-caption text-muted-foreground">Data flow not found.</p>;
		}
		return (
			<>
				<EdgeProperties key={flow.id} flow={flow} />
				<Button
					variant="outline"
					size="sm"
					onClick={() => void requestGraphDeletion({ edgeId: flow.id })}
				>
					Delete connector
				</Button>
			</>
		);
	}

	if (selectedBoundaryId) {
		const boundary = model.trust_boundaries.find((b) => b.id === selectedBoundaryId);
		if (!boundary) {
			return <p className="text-editor-caption text-muted-foreground">Trust boundary not found.</p>;
		}
		return (
			<>
				<TrustBoundaryProperties boundaryId={selectedBoundaryId} />
				<Button
					variant="outline"
					size="sm"
					onClick={() => void requestGraphDeletion({ nodeId: selectedBoundaryId })}
				>
					Delete boundary
				</Button>
			</>
		);
	}

	if (selectedElementId) {
		return (
			<>
				<ElementProperties key={selectedElementId} elementId={selectedElementId} />
				<Button
					variant="outline"
					size="sm"
					onClick={() => void requestGraphDeletion({ nodeId: selectedElementId })}
				>
					Delete element
				</Button>
			</>
		);
	}

	return (
		<div className="py-2">
			<h2 className="text-editor-footnote">Nothing selected</h2>
			<p className="mt-1 text-editor-caption text-muted-foreground">
				Select an element or connector on the canvas to view its properties.
			</p>
		</div>
	);
}
