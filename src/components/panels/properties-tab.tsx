import { MousePointer2 } from "lucide-react";
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
		return <EdgeProperties key={flow.id} flow={flow} />;
	}

	if (selectedBoundaryId) {
		const boundary = model.trust_boundaries.find((b) => b.id === selectedBoundaryId);
		if (!boundary) {
			return <p className="text-editor-caption text-muted-foreground">Trust boundary not found.</p>;
		}
		return <TrustBoundaryProperties boundaryId={selectedBoundaryId} />;
	}

	if (selectedElementId) {
		return <ElementProperties key={selectedElementId} elementId={selectedElementId} />;
	}

	return (
		<div className="px-2 py-8 text-left">
			<MousePointer2 className="mb-3 size-4 text-muted-foreground" aria-hidden="true" />
			<h2 className="text-editor-footnote">Nothing selected</h2>
			<p className="mt-1 text-editor-caption text-muted-foreground">
				Select an element or connector on the canvas to view its properties.
			</p>
		</div>
	);
}
