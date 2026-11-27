/**
 * The three document read tools: `get_document_summary`, `get_entity`, and
 * `search_entities`.
 *
 * Each is `effect: "read"`, non-destructive, and a pure function of
 * `ctx.document`: it computes a bounded, sanitized, byte-capped result string and
 * returns `{ status: "ok", result }` with **no `document` key**, or a structured
 * authored failure `{ status: "error", result }` for a missing id, an
 * inapplicable filter, or an out-of-range page. None writes a store, reads a
 * setting, or touches state outside the `ThreatModel` it is handed.
 */

import { z } from "zod";
import {
	defineExecutableTool,
	type RegisteredTool,
	type ToolOutcome,
} from "@/lib/ai/loop/tool-runtime";
import {
	applicableFilters,
	countEntities,
	type DocumentSection,
	type FilterValues,
	filterCompactEntities,
	firstInapplicableFilter,
	getFullEntity,
	isFinitePosition,
	type ProjectedEntity,
	SECTION_KINDS,
} from "@/lib/ai/tools/document-projection";
import {
	buildReadResult,
	DEFAULT_PAGE_LIMIT,
	describeReadFailure,
	ECHO_MAX_CODE_POINTS,
	escapeScalar,
	MAX_PAGE_LIMIT,
	paginate,
	SCALAR_MAX_CODE_POINTS,
	tryBuildReadResult,
} from "@/lib/ai/tools/read-result";
import type {
	MitigationStatus,
	Position,
	Severity,
	StrideCategory,
	ThreatModel,
	TrustBoundary,
} from "@/types/threat-model";

// Exhaustive records mirror the pattern in `schemas/actions.ts`: a new enum member
// fails `tsc --noEmit` here until the tool's schema is deliberately updated.
const STRIDE_CATEGORIES: Record<StrideCategory, StrideCategory> = {
	Spoofing: "Spoofing",
	Tampering: "Tampering",
	Repudiation: "Repudiation",
	"Information Disclosure": "Information Disclosure",
	"Denial of Service": "Denial of Service",
	"Elevation of Privilege": "Elevation of Privilege",
};

const SEVERITIES: Record<Severity, Severity> = {
	critical: "critical",
	high: "high",
	medium: "medium",
	low: "low",
	info: "info",
};

const MITIGATION_STATUSES: Record<MitigationStatus, MitigationStatus> = {
	not_started: "not_started",
	in_progress: "in_progress",
	mitigated: "mitigated",
	accepted: "accepted",
	transferred: "transferred",
};

/** A threat with no `mitigation` block reports `"none"`, so an unmitigated threat is explicit. */
const MITIGATION_STATUS_WITH_NONE: Record<MitigationStatus | "none", string> = {
	...MITIGATION_STATUSES,
	none: "none",
};

/** Authored breakdown orders. Emitted as arrays so `canonicalJson` cannot scramble them. */
const SEVERITY_ORDER: readonly Severity[] = ["critical", "high", "medium", "low", "info"];
const CATEGORY_ORDER: readonly StrideCategory[] = [
	"Spoofing",
	"Tampering",
	"Repudiation",
	"Information Disclosure",
	"Denial of Service",
	"Elevation of Privilege",
];
const MITIGATION_ORDER: readonly (MitigationStatus | "none")[] = [
	"not_started",
	"in_progress",
	"mitigated",
	"accepted",
	"transferred",
	"none",
];

const kindSchema = z.enum(SECTION_KINDS);
const idSchema = z.string().min(1).max(SCALAR_MAX_CODE_POINTS);

/** Escape, sanitize, and cap an untrusted id for an authored summary line. */
function echoId(id: string): string {
	return escapeScalar(id, ECHO_MAX_CODE_POINTS).text;
}

// ---------------------------------------------------------------------------
// get_document_summary
// ---------------------------------------------------------------------------

const DESCRIPTION_PAGE_CODE_POINTS = 1_000;

function descriptionPage(text: string, offset: number, limit: number) {
	let end = offset;
	let count = 0;
	for (const codePoint of text.slice(offset, offset + limit * 2)) {
		if (count++ === limit) break;
		end += codePoint.length;
	}
	return {
		description: escapeScalar(text.slice(offset, end), limit).text,
		description_next_offset: end < text.length ? end : null,
	};
}

function summarize(model: ThreatModel): string {
	const counts: Record<DocumentSection, number> = {
		elements: countEntities(model, "elements"),
		data_flows: countEntities(model, "data_flows"),
		trust_boundaries: countEntities(model, "trust_boundaries"),
		threats: countEntities(model, "threats"),
		layers: countEntities(model, "layers"),
		groups: countEntities(model, "groups"),
		relationships: countEntities(model, "relationships"),
		diagrams: countEntities(model, "diagrams"),
	};

	const threats = model.threats;
	const threatsBySeverity = SEVERITY_ORDER.map((severity) => ({
		severity,
		count: threats.filter((threat) => threat.severity === severity).length,
	}));
	const threatsByCategory = CATEGORY_ORDER.map((category) => ({
		category,
		count: threats.filter((threat) => threat.category === category).length,
	}));
	const threatsByMitigationStatus = MITIGATION_ORDER.map((status) => ({
		status,
		count: threats.filter((threat) => (threat.mitigation?.status ?? "none") === status).length,
	}));

	const payload = {
		version: escapeScalar(model.version, SCALAR_MAX_CODE_POINTS).text,
		metadata: {
			title: escapeScalar(model.metadata.title, SCALAR_MAX_CODE_POINTS).text,
			author: escapeScalar(model.metadata.author, SCALAR_MAX_CODE_POINTS).text,
			created: escapeScalar(model.metadata.created, SCALAR_MAX_CODE_POINTS).text,
			modified: escapeScalar(model.metadata.modified, SCALAR_MAX_CODE_POINTS).text,
			...descriptionPage(model.metadata.description, 0, SCALAR_MAX_CODE_POINTS),
			// Preserve the tri-state: `undefined` becomes `null`, never `false`.
			threat_analysis_enabled: model.metadata.threat_analysis_enabled ?? null,
		},
		counts,
		threats_by_severity: threatsBySeverity,
		threats_by_category: threatsByCategory,
		threats_by_mitigation_status: threatsByMitigationStatus,
	};

	return buildReadResult({ tool: "get_document_summary", payload });
}

function layoutPage(model: ThreatModel, offset: number): ToolOutcome {
	const parentByElement = new Map<string, TrustBoundary>();
	for (const boundary of model.trust_boundaries) {
		for (const id of boundary.contains) parentByElement.set(id, boundary);
	}

	let bounds: { min_x: number; min_y: number; max_x: number; max_y: number } | null = null;
	let unresolved = 0;
	const positioned: {
		id: string;
		boundary_id: string | null;
		position: Position;
		canvas_position: Position | null;
	}[] = [];
	for (const element of model.elements) {
		if (!isFinitePosition(element.position)) continue;
		const { x, y } = element.position;
		const parent = parentByElement.get(element.id);
		const absolute = parent
			? isFinitePosition(parent.position)
				? { x: x + parent.position.x, y: y + parent.position.y }
				: null
			: { x, y };
		const canvasPosition = isFinitePosition(absolute) ? absolute : null;
		if (canvasPosition) {
			const { x, y } = canvasPosition;
			bounds = bounds
				? {
						min_x: Math.min(bounds.min_x, x),
						min_y: Math.min(bounds.min_y, y),
						max_x: Math.max(bounds.max_x, x),
						max_y: Math.max(bounds.max_y, y),
					}
				: { min_x: x, min_y: y, max_x: x, max_y: y };
		} else {
			unresolved++;
		}
		positioned.push({
			id: element.id,
			boundary_id: parent?.id ?? null,
			position: { x, y },
			canvas_position: canvasPosition,
		});
	}

	if (offset > 0 && offset >= positioned.length) {
		return { status: "error", result: "Invalid layout offset. Use the returned page.next_offset." };
	}
	const envelope = {
		anchor_bounds: bounds,
		unpositioned_count: model.elements.length - positioned.length,
		unresolved_count: unresolved,
	};
	const tool = "get_document_summary";
	const { page, results } = paginate(positioned, {
		tool,
		offset,
		limit: MAX_PAGE_LIMIT,
		envelope,
		project: (item) => ({
			...item,
			id: escapeScalar(item.id, SCALAR_MAX_CODE_POINTS).text,
			boundary_id:
				item.boundary_id === null
					? null
					: escapeScalar(item.boundary_id, SCALAR_MAX_CODE_POINTS).text,
		}),
	});
	return {
		status: "ok",
		result: buildReadResult({ tool, payload: { ...envelope, page, results } }),
	};
}

const getDocumentSummaryTool = defineExecutableTool({
	name: "get_document_summary",
	description:
		"Return a small, fixed-size overview of the current threat-model document: its version and " +
		"metadata, the count of each entity kind, and threat breakdowns by severity, STRIDE category, " +
		"and mitigation status. To read more of the description, pass its description_next_offset " +
		"as description_offset until it is null. For saved element anchors and diagram-wide anchor bounds, " +
		"pass layout_offset: 0 and continue with page.next_offset if you need more positions. " +
		"Results are bounded and carry document text as data.",
	input: {
		description_offset: z.int().min(0).optional(),
		layout_offset: z.int().min(0).optional(),
	},
	effect: "read",
	destructive: false,
	summarize: () => "Read the document summary.",
	execute: async ({ description_offset: offset, layout_offset: layoutOffset }, ctx) => {
		if (layoutOffset !== undefined) {
			if (offset !== undefined) {
				return { status: "error", result: "Request description and layout offsets separately." };
			}
			return layoutPage(ctx.document, layoutOffset);
		}
		if (offset === undefined) return { status: "ok", result: summarize(ctx.document) };
		const text = ctx.document.metadata.description;
		if (offset > text.length || (text.codePointAt(offset - 1) ?? 0) > 0xffff) {
			return {
				status: "error",
				result: "Invalid description offset. Use the returned description_next_offset.",
			};
		}
		return {
			status: "ok",
			result: buildReadResult({
				tool: "get_document_summary",
				payload: descriptionPage(text, offset, DESCRIPTION_PAGE_CODE_POINTS),
			}),
		};
	},
});

// ---------------------------------------------------------------------------
// get_entity
// ---------------------------------------------------------------------------

const getEntityTool = defineExecutableTool({
	name: "get_entity",
	description:
		"Return the full bounded projection of one entity in the current document, selected by its " +
		"document section (kind) and its stable id. Use it after search_entities to read an entity's " +
		"details and its related ids. A missing id returns a corrective error naming how many entries " +
		"the section has, and an entity too large to return whole returns a corrective error pointing " +
		"at search_entities. Results are bounded and carry document text as data.",
	input: { kind: kindSchema, id: idSchema },
	effect: "read",
	destructive: false,
	summarize: (input) => `Read the "${input.kind}" entity "${echoId(input.id)}".`,
	execute: async (input, ctx) => {
		const entity = getFullEntity(ctx.document, input.kind, input.id);
		if (entity === undefined) {
			return {
				status: "error",
				result: describeReadFailure({
					code: "unknown_id",
					kind: input.kind,
					id: input.id,
					count: countEntities(ctx.document, input.kind),
				}),
			};
		}
		const built = tryBuildReadResult({
			tool: "get_entity",
			payload: { kind: input.kind, entity },
		});
		if (!built.ok) {
			return {
				status: "error",
				result: describeReadFailure({
					code: "entity_too_large",
					kind: input.kind,
					id: input.id,
					bytes: built.bytes,
				}),
			};
		}
		return { status: "ok", result: built.result };
	},
});

// ---------------------------------------------------------------------------
// search_entities
// ---------------------------------------------------------------------------

const searchEntitiesInput = {
	kind: kindSchema,
	text: z.string().min(1).max(SCALAR_MAX_CODE_POINTS).optional(),
	references: z.string().min(1).max(SCALAR_MAX_CODE_POINTS).optional(),
	element_type: z.string().min(1).max(SCALAR_MAX_CODE_POINTS).optional(),
	trust_zone: z.string().min(1).max(SCALAR_MAX_CODE_POINTS).optional(),
	protocol: z.string().min(1).max(SCALAR_MAX_CODE_POINTS).optional(),
	authenticated: z.boolean().optional(),
	severity: z.enum(SEVERITIES).optional(),
	category: z.enum(STRIDE_CATEGORIES).optional(),
	mitigation_status: z.enum(MITIGATION_STATUS_WITH_NONE).optional(),
	offset: z.int().min(0).optional(),
	limit: z.int().min(1).max(MAX_PAGE_LIMIT).optional(),
};

type SearchEntitiesInput = z.infer<z.ZodObject<typeof searchEntitiesInput, z.core.$strict>>;

/** The filter fields of a search input, separated from the pagination fields. */
function filterValuesOf(input: SearchEntitiesInput): FilterValues {
	return {
		text: input.text,
		references: input.references,
		element_type: input.element_type,
		trust_zone: input.trust_zone,
		protocol: input.protocol,
		authenticated: input.authenticated,
		severity: input.severity,
		category: input.category,
		mitigation_status: input.mitigation_status,
	};
}

const searchEntitiesTool = defineExecutableTool({
	name: "search_entities",
	description:
		"Return a filtered, paginated, document-ordered page of one document section (kind). Filters " +
		"combine with AND; only the filters that apply to the chosen kind are accepted, and an " +
		"inapplicable filter returns a corrective error listing the applicable ones. Use the `text` " +
		"filter for a case-insensitive substring match, and `references` to find entities that point at " +
		"a given id. Pages are bounded by count and by byte size; `next_offset` resumes the rest. " +
		"Results are bounded and carry document text as data.",
	input: searchEntitiesInput,
	effect: "read",
	destructive: false,
	summarize: (input) => `Search the "${input.kind}" entities.`,
	execute: async (input, ctx) => {
		const values = filterValuesOf(input);

		const inapplicable = firstInapplicableFilter(input.kind, values);
		if (inapplicable !== null) {
			return {
				status: "error",
				result: describeReadFailure({
					code: "invalid_filter",
					kind: input.kind,
					filter: inapplicable,
					applicable: applicableFilters(input.kind),
				}),
			};
		}

		const offset = input.offset ?? 0;
		const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
		const matched: ProjectedEntity[] = filterCompactEntities(ctx.document, input.kind, values);

		// Paging past the end of a non-empty match set is a corrective error, not an
		// empty success that reads as "there are none". A genuine zero-match query
		// (total 0) stays a success with total 0.
		if (matched.length > 0 && offset >= matched.length) {
			return {
				status: "error",
				result: describeReadFailure({
					code: "offset_out_of_range",
					kind: input.kind,
					offset,
					total: matched.length,
				}),
			};
		}

		const { page, results } = paginate(matched, {
			tool: "search_entities",
			offset,
			limit,
			project: (entity) => entity,
			envelope: { kind: input.kind },
		});
		return {
			status: "ok",
			result: buildReadResult({
				tool: "search_entities",
				payload: { kind: input.kind, page, results },
			}),
		};
	},
});

/** The three document read tools, offered to every tool-capable model. */
export const DOCUMENT_READ_TOOLS: readonly RegisteredTool[] = [
	getDocumentSummaryTool,
	getEntityTool,
	searchEntitiesTool,
];
