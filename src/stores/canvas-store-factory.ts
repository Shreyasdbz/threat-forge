import type { Connection, Edge, OnEdgesChange, OnNodesChange, Viewport } from "@xyflow/react";
import { applyEdgeChanges, applyNodeChanges } from "@xyflow/react";
import { createStore, type StoreApi } from "zustand/vanilla";
import {
	boundaryToNode,
	type DfdEdge,
	type DfdNode,
	elementToNode,
	flowToEdge,
	projectCanvas,
} from "@/lib/canvas-projection";
import {
	getSelfLoopHandlePair,
	getSmartHandlePair,
	isSelfLoop,
	nodeToRect,
} from "@/lib/canvas-utils";
import { getComponent } from "@/lib/registry/registry";
import { removeGraphItems } from "@/lib/remove-graph-items";
import type {
	DataFlow,
	DiagramLayout,
	Element,
	Position,
	Size,
	ThreatModel,
	TrustBoundary,
} from "@/types/threat-model";
import { useCanvasInstanceStore } from "./canvas-instance-store";
import type { HistoryState } from "./history-store-factory";
import type { ModelState } from "./model-store-factory";

export type { DfdEdge, DfdEdgeData, DfdNode, DfdNodeData } from "@/lib/canvas-projection";

export interface GraphDeletion {
	nodes: readonly string[];
	edges: readonly string[];
}

export function selectedGraphItems(
	canvas: Pick<CanvasState, "nodes" | "edges">,
	selectedEdgeId: string | null,
): GraphDeletion {
	const nodes = canvas.nodes.filter((node) => node.selected).map((node) => node.id);
	const edges = canvas.edges.filter((edge) => edge.selected).map((edge) => edge.id);
	if (!nodes.length && !edges.length && selectedEdgeId) edges.push(selectedEdgeId);
	return { nodes, edges };
}

export interface CanvasState {
	nodes: DfdNode[];
	edges: DfdEdge[];
	viewport: Viewport;
	passiveUpdate: number;

	/** Layout to apply on next syncFromModel (set before loading a model) */
	pendingLayout: DiagramLayout | null;

	// ReactFlow change handlers
	onNodesChange: (
		changes: Parameters<OnNodesChange<DfdNode>>[0],
		keyboard?: Pick<KeyboardEvent, "key" | "repeat">,
	) => void;
	resizeArchitectureGroup: (id: string, size: Size) => void;
	onEdgesChange: OnEdgesChange<DfdEdge>;
	setViewport: (viewport: Viewport, passive?: boolean) => void;
	setPendingLayout: (layout: DiagramLayout | null) => void;

	// Canvas actions
	addElement: (
		type: string,
		position: { x: number; y: number },
		opts?: { subtype?: string; icon?: string; name?: string },
	) => void;
	addDataFlow: (
		sourceId: string,
		targetId: string,
		opts?: { sourceHandle?: string; targetHandle?: string; name?: string },
	) => string | null;
	addTrustBoundary: (name: string, position: { x: number; y: number }) => void;
	deleteSelected: (targets?: GraphDeletion) => void;
	duplicateElement: (
		nodeId: string,
		opts?: { offset?: { x: number; y: number }; select?: boolean; skipHistory?: boolean },
	) => string | null;
	reverseEdge: (edgeId: string) => void;
	reconnectEdge: (oldEdge: Edge, newConnection: Connection) => void;

	/** Allocate the next `comp-N` element id for this document. */
	nextElementId: () => string;
	/** Allocate the next `flow-N` data-flow id for this document. */
	nextFlowId: () => string;
	/** Allocate the next `boundary-N` trust-boundary id for this document. */
	nextBoundaryId: () => string;

	/** Nudge selected nodes by a delta (in flow coordinates) */
	nudgeSelected: (dx: number, dy: number) => void;

	// Sync from model store
	syncFromModel: () => void;
}

export interface CanvasStoreDeps {
	/** The model store owned by the same document. */
	model: StoreApi<ModelState>;
	/** The history store owned by the same document. */
	history: StoreApi<HistoryState>;
}

/** Write current canvas node positions into the model's inline position fields. */
function writePositionsToModel(model: ThreatModel, nodes: DfdNode[]): ThreatModel {
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));
	return {
		...model,
		elements: model.elements.map((el) => {
			const node = nodeMap.get(el.id);
			if (!node) return el;
			return { ...el, position: { x: node.position.x, y: node.position.y } };
		}),
		trust_boundaries: model.trust_boundaries.map((b) => {
			const node = nodeMap.get(b.id);
			if (!node) return b;
			const w = node.width ?? (node.style as Record<string, number> | undefined)?.width ?? 400;
			const h = node.height ?? (node.style as Record<string, number> | undefined)?.height ?? 300;
			return {
				...b,
				position: { x: node.position.x, y: node.position.y },
				size: { width: w, height: h },
			};
		}),
	};
}

function updateGroupGeometry(
	model: ThreatModel,
	id: string,
	geometry: { position?: Position; size?: Size },
): ThreatModel {
	return {
		...model,
		groups: model.groups?.map((group) => (group.id === id ? { ...group, ...geometry } : group)),
	};
}

function defaultElementName(type: string): string {
	return getComponent(type)?.label ?? "New Component";
}

/**
 * Create a canvas store bound to one document's model and history stores.
 *
 * The model and history stores arrive by injection rather than through a module import, so a
 * canvas store can only ever write into the document it belongs to. Gesture snapshots and id
 * counters live in this closure for the same reason.
 */
export function createCanvasStore(deps: CanvasStoreDeps): StoreApi<CanvasState> {
	/** Model snapshot captured at the start of a drag (with pre-drag canvas positions baked in). */
	let preDragSnapshot: ThreatModel | null = null;
	let lastKeyboardMove: { model: ThreatModel; key: string } | null = null;

	/** Nudge gesture state (arrow key): snapshot + debounce timer. */
	const nudgeState = {
		snapshot: null as ThreatModel | null,
		timer: null as ReturnType<typeof setTimeout> | null,
	};

	let elementCounter = 0;
	let flowCounter = 0;
	let boundaryCounter = 0;

	return createStore<CanvasState>((set, get) => ({
		nodes: [],
		edges: [],
		viewport: { x: 0, y: 0, zoom: 1 },
		passiveUpdate: 0,
		pendingLayout: null,

		nextElementId: () => {
			elementCounter++;
			return `comp-${elementCounter}`;
		},

		nextFlowId: () => {
			flowCounter++;
			return `flow-${flowCounter}`;
		},

		nextBoundaryId: () => {
			boundaryCounter++;
			return `boundary-${boundaryCounter}`;
		},

		onNodesChange: (changes, keyboard) => {
			const previousNodes = get().nodes;
			// Capture pre-drag model snapshot BEFORE applying changes (nodes still have old positions)
			const hasDragStart = changes.some((c) => c.type === "position" && c.dragging === true);
			if (hasDragStart && !preDragSnapshot) {
				const model = deps.model.getState().model;
				if (model) {
					preDragSnapshot = writePositionsToModel(model, previousNodes);
				}
			}

			const key = keyboard?.key;
			const horizontal = key === "ArrowLeft" || key === "ArrowRight";
			const vertical = key === "ArrowUp" || key === "ArrowDown";
			let keyboardMoved = false;
			const appliedChanges =
				!preDragSnapshot && (horizontal || vertical)
					? changes.map((change) => {
							if (change.type !== "position" || change.dragging !== false || !change.position) {
								return change;
							}
							const before = previousNodes.find((node) => node.id === change.id)?.position;
							if (!before) return change;
							const position = {
								x: horizontal ? change.position.x : before.x,
								y: vertical ? change.position.y : before.y,
							};
							keyboardMoved ||= position.x !== before.x || position.y !== before.y;
							return { ...change, position };
						})
					: changes;
			const passive = appliedChanges.every(
				(change) =>
					change.type === "select" || (change.type === "dimensions" && !change.setAttributes),
			);
			set((state) => ({
				nodes: applyNodeChanges(appliedChanges, previousNodes) as DfdNode[],
				passiveUpdate: state.passiveUpdate + Number(passive),
			}));

			// Handle drag end: push pre-drag snapshot to history, write new positions to model.
			// Skip when altDragActive — the onNodeDragStop handler owns history for Alt+drag.
			// This is the one intentional read of workspace canvas state from the canvas store:
			// Alt+drag is an in-flight pointer gesture on the mounted canvas, not document state.
			const altDragActive = useCanvasInstanceStore.getState().altDragActive;
			const hasDragEnd = changes.some((c) => c.type === "position" && c.dragging === false);
			if (hasDragEnd && !altDragActive) {
				const model = deps.model.getState().model;
				if (model && (preDragSnapshot || keyboardMoved)) {
					const isRepeat =
						keyboardMoved &&
						keyboard?.repeat &&
						lastKeyboardMove?.model === model &&
						lastKeyboardMove.key === key;
					if (!isRepeat) {
						deps.history
							.getState()
							.pushSnapshot(preDragSnapshot ?? writePositionsToModel(model, previousNodes));
					}
					const nodes = get().nodes;
					let updated = writePositionsToModel(model, nodes);
					for (const change of changes) {
						if (change.type !== "position" || change.dragging !== false) continue;
						const node = nodes.find((candidate) => candidate.id === change.id);
						if (node?.data.architectureGroupId != null) {
							updated = updateGroupGeometry(updated, node.data.architectureGroupId, {
								position: node.position,
								size: { width: node.width ?? 420, height: node.height ?? 280 },
							});
						}
					}
					if (keyboardMoved && key) lastKeyboardMove = { model: updated, key };
					deps.model.setState({ model: updated, isDirty: true });
				}
			}
			if (hasDragEnd) preDragSnapshot = null;

			// Handle selection changes — process the last selected node for model-store sync.
			// In multi-select batches, multiple nodes may be selected at once; use the last
			// one as the "active" selection for the properties panel.
			const selectionChanges = changes.filter((c) => c.type === "select" && c.selected);
			if (selectionChanges.length > 0) {
				const lastChange = selectionChanges[selectionChanges.length - 1];
				if (lastChange.type === "select") {
					const node = get().nodes.find((n) => n.id === lastChange.id);
					if (node?.data.isBoundary) {
						deps.model.getState().setSelectedBoundary(lastChange.id);
					} else if (node && !node.data.isBoundary) {
						deps.model.getState().setSelectedElement(lastChange.id);
					}
				}
			}

			// Handle deselection — only clear model selection when zero nodes remain selected
			const hasDeselection = changes.some((c) => c.type === "select" && !c.selected);
			if (hasDeselection && !changes.some((c) => c.type === "select" && c.selected)) {
				const anyStillSelected = get().nodes.some((n) => n.selected);
				if (!anyStillSelected) {
					deps.model.getState().setSelectedElement(null);
					deps.model.getState().setSelectedBoundary(null);
				}
			}
		},
		resizeArchitectureGroup: (id, size) => {
			const { model } = deps.model.getState();
			const node = get().nodes.find((candidate) => candidate.id === id);
			if (!model || node?.data.architectureGroupId == null) return;
			deps.history.getState().pushSnapshot(model);
			deps.model.setState({
				model: updateGroupGeometry(model, node.data.architectureGroupId, {
					position: node.position,
					size,
				}),
				isDirty: true,
			});
		},

		onEdgesChange: (changes) => {
			const removals = changes.filter(
				(c): c is Extract<typeof c, { type: "remove" }> => c.type === "remove",
			);
			if (removals.length > 0) {
				const { model, filePath, checkSequenceReferences } = deps.model.getState();
				if (model) {
					const removedIds = new Set(removals.map((r) => r.id));
					const proposed = {
						...model,
						data_flows: model.data_flows.filter((f) => !removedIds.has(f.id)),
					};
					if (!checkSequenceReferences(proposed)) return;
					deps.history.getState().pushSnapshot(model);
					deps.model.getState().setModel(proposed, filePath);
					deps.model.getState().markDirty();
				}
			}
			set((state) => ({
				edges: applyEdgeChanges(changes, state.edges),
				passiveUpdate: state.passiveUpdate + Number(changes.every((c) => c.type === "select")),
			}));
		},

		setViewport: (viewport, passive = false) => {
			const current = get().viewport;
			if (current.x !== viewport.x || current.y !== viewport.y || current.zoom !== viewport.zoom) {
				set((state) => ({
					viewport,
					passiveUpdate: state.passiveUpdate + Number(passive),
				}));
			}
		},
		setPendingLayout: (layout) => set({ pendingLayout: layout }),

		addElement: (type, position, opts) => {
			const id = get().nextElementId();
			const name = opts?.name ?? defaultElementName(type);

			const newElement: Element = {
				id,
				type,
				name,
				trust_zone: "",
				subtype: opts?.subtype,
				icon: opts?.icon,
				description: "",
				technologies: [],
				position: { x: position.x, y: position.y },
			};

			const newNode = elementToNode(newElement, position);

			// Check if the drop position is inside a trust boundary
			const boundaryNode = get().nodes.find((n) => {
				if (!n.data.isBoundary) return false;
				const bw = n.width ?? (n.style as Record<string, number> | undefined)?.width ?? 400;
				const bh = n.height ?? (n.style as Record<string, number> | undefined)?.height ?? 300;
				return (
					position.x >= n.position.x &&
					position.x <= n.position.x + bw &&
					position.y >= n.position.y &&
					position.y <= n.position.y + bh
				);
			});

			if (boundaryNode) {
				newNode.parentId = boundaryNode.id;
				newNode.extent = "parent";
				// Adjust position to be relative to the boundary
				newNode.position = {
					x: position.x - boundaryNode.position.x,
					y: position.y - boundaryNode.position.y,
				};
			}

			// Update canvas
			set({ nodes: [...get().nodes, newNode] });

			// Update model store
			const model = deps.model.getState().model;
			if (model) {
				deps.history.getState().pushSnapshot(model);
				// If dropped inside boundary, add to its contains array
				let updatedBoundaries = model.trust_boundaries;
				if (boundaryNode) {
					updatedBoundaries = model.trust_boundaries.map((b) =>
						b.id === boundaryNode.id ? { ...b, contains: [...b.contains, id] } : b,
					);
				}
				deps.model.getState().setModel(
					{
						...model,
						elements: [...model.elements, newElement],
						trust_boundaries: updatedBoundaries,
					},
					deps.model.getState().filePath,
				);
				deps.model.getState().markDirty();
			}

			// Select the new element
			deps.model.getState().setSelectedElement(id);
		},

		addDataFlow: (sourceId, targetId, opts) => {
			const id = get().nextFlowId();

			// Compute next flow number from current model
			const currentModel = deps.model.getState().model;
			const maxFlowNumber = currentModel
				? currentModel.data_flows.reduce((max, f) => Math.max(max, f.flow_number ?? 0), 0)
				: 0;
			const nextFlowNumber = maxFlowNumber + 1;

			// Determine handles: explicit from user drag, smart routing, or self-loop defaults
			let resolvedSourceHandle: string | undefined;
			let resolvedTargetHandle: string | undefined;
			if (opts?.sourceHandle && opts?.targetHandle) {
				resolvedSourceHandle = opts.sourceHandle;
				resolvedTargetHandle = opts.targetHandle;
			} else if (isSelfLoop(sourceId, targetId)) {
				// Default handle pair for self-loops
				const pair = getSelfLoopHandlePair();
				resolvedSourceHandle = pair.sourceHandle;
				resolvedTargetHandle = pair.targetHandle;
			} else {
				const sourceNode = get().nodes.find((n) => n.id === sourceId);
				const targetNode = get().nodes.find((n) => n.id === targetId);
				if (sourceNode && targetNode) {
					const handlePair = getSmartHandlePair(nodeToRect(sourceNode), nodeToRect(targetNode));
					resolvedSourceHandle = handlePair.sourceHandle;
					resolvedTargetHandle = handlePair.targetHandle;
				}
			}

			const newFlow: DataFlow = {
				id,
				flow_number: nextFlowNumber,
				name: opts?.name ?? "",
				from: sourceId,
				to: targetId,
				protocol: "",
				data: [],
				authenticated: false,
				source_handle: resolvedSourceHandle,
				target_handle: resolvedTargetHandle,
			};

			const newEdge = flowToEdge(newFlow);

			set({ edges: [...get().edges, newEdge] });

			// Update model store
			const model = deps.model.getState().model;
			if (model) {
				deps.history.getState().pushSnapshot(model);
				deps.model
					.getState()
					.setModel(
						{ ...model, data_flows: [...model.data_flows, newFlow] },
						deps.model.getState().filePath,
					);
				deps.model.getState().markDirty();
			}

			return id;
		},

		addTrustBoundary: (name, position) => {
			const id = get().nextBoundaryId();
			const newBoundary: TrustBoundary = {
				id,
				name,
				contains: [],
				position: { x: position.x, y: position.y },
			};

			const newNode = boundaryToNode(newBoundary, position);
			// Insert boundaries at the beginning so they render behind other nodes
			set({ nodes: [newNode, ...get().nodes] });

			// Update model store
			const model = deps.model.getState().model;
			if (model) {
				deps.history.getState().pushSnapshot(model);
				deps.model.getState().setModel(
					{
						...model,
						trust_boundaries: [...model.trust_boundaries, newBoundary],
					},
					deps.model.getState().filePath,
				);
				deps.model.getState().markDirty();
			}
		},

		deleteSelected: (targets = selectedGraphItems(get(), deps.model.getState().selectedEdgeId)) => {
			const currentNodes = get().nodes;
			const currentEdges = get().edges;
			const targetNodes = new Set(targets.nodes);
			const targetEdges = new Set(targets.edges);
			const selectedNodes = currentNodes.filter((node) => targetNodes.has(node.id));
			const selectedEdges = currentEdges.filter((edge) => targetEdges.has(edge.id));

			if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

			const selectedNodeIds = new Set(selectedNodes.map((n) => n.id));
			const selectedEdgeIds = new Set(selectedEdges.map((e) => e.id));
			const { model, filePath, checkSequenceReferences } = deps.model.getState();
			const proposed =
				model &&
				removeGraphItems(model, {
					elements: new Set(
						selectedNodes.filter((n) => n.type !== "trustBoundary").map((n) => n.id),
					),
					boundaries: new Set(
						selectedNodes.filter((n) => n.type === "trustBoundary").map((n) => n.id),
					),
					flows: selectedEdgeIds,
				});
			if (proposed && !checkSequenceReferences(proposed)) return;

			// Find all edges to remove: explicitly selected + connected to removed nodes
			const connectedEdgeIds = currentEdges
				.filter((e) => selectedNodeIds.has(e.source) || selectedNodeIds.has(e.target))
				.map((e) => e.id);
			const allRemovedEdgeIds = new Set([...selectedEdgeIds, ...connectedEdgeIds]);

			// Remove nodes and affected edges
			const nextNodes = currentNodes.filter((n) => !selectedNodeIds.has(n.id));
			const nextEdges = currentEdges.filter((e) => !allRemovedEdgeIds.has(e.id));

			set({ nodes: nextNodes, edges: nextEdges });

			// Update model store
			if (model && proposed) {
				deps.history.getState().pushSnapshot(model);
				deps.model.getState().setModel(proposed, filePath);
				deps.model.getState().markDirty();
				deps.model.getState().setSelectedElement(null);
			}
		},

		duplicateElement: (nodeId, opts) => {
			const model = deps.model.getState().model;
			if (!model) return null;

			const element = model.elements.find((e) => e.id === nodeId);
			if (!element) return null;

			const sourceNode = get().nodes.find((n) => n.id === nodeId);
			const offset = opts?.offset ?? { x: 50, y: 50 };
			const offsetX = sourceNode ? sourceNode.position.x + offset.x : 200;
			const offsetY = sourceNode ? sourceNode.position.y + offset.y : 200;

			const newId = get().nextElementId();
			const newElement: Element = {
				...element,
				id: newId,
				name: `${element.name} (copy)`,
			};

			const newNode = elementToNode(newElement, { x: offsetX, y: offsetY });
			set({ nodes: [...get().nodes, newNode] });

			if (!opts?.skipHistory) {
				deps.history.getState().pushSnapshot(model);
			}
			deps.model
				.getState()
				.setModel(
					{ ...model, elements: [...model.elements, newElement] },
					deps.model.getState().filePath,
				);
			deps.model.getState().markDirty();
			if (opts?.select !== false) {
				deps.model.getState().setSelectedElement(newId);
			}
			return newId;
		},

		reverseEdge: (edgeId) => {
			const model = deps.model.getState().model;
			if (!model) return;

			const flow = model.data_flows.find((f) => f.id === edgeId);
			if (!flow) return;

			// Update model: swap from/to and handles (use direct set to preserve selection state)
			const updatedFlows = model.data_flows.map((f) =>
				f.id === edgeId
					? {
							...f,
							from: f.to,
							to: f.from,
							source_handle: f.target_handle?.replace("target", "source"),
							target_handle: f.source_handle?.replace("source", "target"),
						}
					: f,
			);
			const proposed = { ...model, data_flows: updatedFlows };
			if (!deps.model.getState().checkSequenceReferences(proposed)) return;
			deps.history.getState().pushSnapshot(model);
			deps.model.setState({
				model: proposed,
				isDirty: true,
			});

			// Update canvas edge: swap source/target
			const currentEdges = get().edges;
			const updatedEdges = currentEdges.map((e) =>
				e.id === edgeId
					? {
							...e,
							source: e.target,
							target: e.source,
							sourceHandle: e.targetHandle?.replace("target", "source"),
							targetHandle: e.sourceHandle?.replace("source", "target"),
						}
					: e,
			);
			set({ edges: updatedEdges });
		},

		reconnectEdge: (oldEdge, newConnection) => {
			const model = deps.model.getState().model;
			if (!model) return;
			if (!newConnection.source || !newConnection.target) return;

			const flow = model.data_flows.find((f) => f.id === oldEdge.id);
			if (!flow) return;

			// Update model data_flows
			const updatedFlows = model.data_flows.map((f) =>
				f.id === oldEdge.id
					? {
							...f,
							from: newConnection.source as string,
							to: newConnection.target as string,
							source_handle: newConnection.sourceHandle ?? undefined,
							target_handle: newConnection.targetHandle ?? undefined,
						}
					: f,
			);
			const proposed = { ...model, data_flows: updatedFlows };
			if (!deps.model.getState().checkSequenceReferences(proposed)) return;
			deps.history.getState().pushSnapshot(model);
			deps.model.setState({
				model: proposed,
				isDirty: true,
			});

			// Update canvas edges
			const currentEdges = get().edges;
			const updatedEdges = currentEdges.map((e) =>
				e.id === oldEdge.id
					? {
							...e,
							source: newConnection.source as string,
							target: newConnection.target as string,
							sourceHandle: newConnection.sourceHandle,
							targetHandle: newConnection.targetHandle,
						}
					: e,
			);
			set({ edges: updatedEdges });
		},

		nudgeSelected: (dx, dy) => {
			const model = deps.model.getState().model;
			if (!model) return;

			const selectedNodes = get().nodes.filter((n) => n.selected && !n.data.isBoundary);
			if (selectedNodes.length === 0) return;

			// Capture pre-nudge snapshot on the first keypress of a gesture
			if (!nudgeState.snapshot) {
				nudgeState.snapshot = writePositionsToModel(model, get().nodes);
			}

			// Only update canvas nodes — do NOT touch the model store yet.
			// This avoids triggering syncFromModel which destroys focus.
			const updatedNodes = get().nodes.map((n) => {
				if (!n.selected || n.data.isBoundary) return n;
				return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
			});
			set({ nodes: updatedNodes });

			// Debounce: flush to model + history after 300ms of no nudging
			if (nudgeState.timer) clearTimeout(nudgeState.timer);
			nudgeState.timer = setTimeout(() => {
				const currentModel = deps.model.getState().model;
				if (!currentModel) return;
				// Push the pre-nudge snapshot to history for undo
				if (nudgeState.snapshot) {
					deps.history.getState().pushSnapshot(nudgeState.snapshot);
				}
				// Write final positions to model
				const final = writePositionsToModel(currentModel, get().nodes);
				deps.model.setState({ model: final, isDirty: true });
				nudgeState.snapshot = null;
				nudgeState.timer = null;
			}, 300);
		},

		syncFromModel: () => {
			const model = deps.model.getState().model;
			if (!model) {
				set((state) => ({
					nodes: [],
					edges: [],
					pendingLayout: null,
					passiveUpdate: state.passiveUpdate + 1,
				}));
				return;
			}

			// Consume pending layout (set before loading a model via setPendingLayout)
			const layout = get().pendingLayout;
			if (model === lastKeyboardMove?.model && !layout) return;

			// Reset counters based on existing IDs
			const maxElementNum = model.elements.reduce((max, e) => {
				const match = e.id.match(/-(\d+)$/);
				return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
			}, 0);
			const maxFlowNum = model.data_flows.reduce((max, f) => {
				const match = f.id.match(/-(\d+)$/);
				return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
			}, 0);
			const maxBoundaryNum = model.trust_boundaries.reduce((max, b) => {
				const match = b.id.match(/-(\d+)$/);
				return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
			}, 0);
			elementCounter = maxElementNum;
			flowCounter = maxFlowNum;
			boundaryCounter = maxBoundaryNum;

			const { nodes, edges } = projectCanvas(model, get(), layout);

			set((state) => ({
				nodes,
				edges,
				pendingLayout: null,
				passiveUpdate: state.passiveUpdate + 1,
				...(layout ? { viewport: layout.viewport } : {}),
			}));
		},
	}));
}
