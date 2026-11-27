import { z } from "zod";
import {
	canonicalJson,
	defineExecutableTool,
	type ExecutableToolSpec,
	type RegisteredTool,
} from "@/lib/ai/loop/tool-runtime";
import type { ThreatModel } from "@/types/threat-model";

const id = z.string();
const identity = z.object({ id });
const nonblank = z.string().refine((value) => value.trim().length !== 0, "Must not be blank.");
const destination = nonblank.nullable();
const text = z.string().nullish();
const metadata = {
	name: nonblank.nullish(),
	description: text,
};
const stroke = {
	stroke_color: z
		.string()
		.regex(/^#[a-f\d]{6}$/i, "Use a #RRGGBB color.")
		.nullish(),
	stroke_opacity: z.number().min(0).max(1).nullish(),
};

function patchOptional<T>(prior: T | undefined, patch: T | null | undefined): T | undefined {
	return patch === undefined ? prior : (patch ?? undefined);
}

function summarize(description: string, fields: Record<string, unknown>): string {
	const details = Object.entries(fields)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key.replace(/_/g, " ")}: ${value === null ? "none" : value}`)
		.join(", ");
	return `${description} ${details}`;
}

function replace<T extends { id: string }>(
	items: readonly T[],
	id: string,
	kind: string,
	change: (item: T) => T,
): T[] {
	const index = items.findIndex((item) => item.id === id);
	if (index === -1) throw new Error(`${kind} not found: ${id}.`);
	return items.map((item, i) => (i === index ? change(item) : item));
}

function remove<T extends { id: string }>(
	items: readonly T[],
	id: string,
	kind: string,
	checkEmpty?: () => void,
): T[] {
	if (!items.some((item) => item.id === id)) throw new Error(`${kind} not found: ${id}.`);
	checkEmpty?.();
	return items.filter((item) => item.id !== id);
}

function tool<Shape extends { id: z.ZodString | typeof nonblank }>(
	name: string,
	description: string,
	input: Shape,
	change: (
		fields: Parameters<ExecutableToolSpec<Shape>["execute"]>[0],
		document: ThreatModel,
	) => ThreatModel,
): RegisteredTool {
	const executable = defineExecutableTool({
		name,
		description,
		input,
		effect: "mutate",
		destructive: name.startsWith("delete_"),
		summarize: (fields) => summarize(description, fields),
		execute: async (fields, { document, signal }) => {
			if (signal.aborted) return { status: "error", result: "The change was cancelled." };
			try {
				return {
					status: "ok",
					result: JSON.stringify({ action: name, id: identity.parse(fields).id }),
					document: change(fields, document),
				};
			} catch (error) {
				return {
					status: "error",
					result: error instanceof Error ? error.message : "The change could not be applied.",
				};
			}
		},
	});
	return { ...executable, stageable: true };
}

function deletion(
	name: string,
	description: string,
	section: "relationships" | "groups" | "layers",
	change: (fields: { id: string }, model: ThreatModel) => ThreatModel,
): RegisteredTool {
	const base = tool(name, description, { id }, change);
	return {
		...base,
		prepare(raw, reviewDocument) {
			const prepared = base.prepare(raw);
			if (!prepared.ok || reviewDocument === undefined) return prepared;
			const { id } = identity.parse(raw);
			const target = (document: ThreatModel | null) =>
				document?.[section]?.find((entity) => entity.id === id);
			const before = canonicalJson(target(reviewDocument) ?? null);
			return {
				ok: true,
				call: {
					...prepared.call,
					run: async (ctx) =>
						canonicalJson(target(ctx.document) ?? null) === before
							? prepared.call.run(ctx)
							: {
									status: "error",
									result:
										"The document changed after this deletion was proposed. Request a new proposal.",
								},
				},
			};
		},
	};
}

export const ARCHITECTURE_TOOLS: readonly RegisteredTool[] = [
	tool(
		"add_relationship",
		"Add an architecture relationship between two existing element IDs, not a data flow.",
		{ id: nonblank, type: nonblank, from: id, to: id, ...metadata, ...stroke },
		({ id, type, from, to, name, description, stroke_color, stroke_opacity }, doc) => ({
			...doc,
			relationships: [
				...(doc.relationships ?? []),
				{
					id,
					type,
					from,
					to,
					name: name ?? undefined,
					description: description ?? undefined,
					stroke_color: stroke_color ?? undefined,
					stroke_opacity: stroke_opacity ?? undefined,
				},
			],
		}),
	),
	tool(
		"update_relationship",
		"Update or reconnect a relationship. Use null to clear its name, description or stroke styling.",
		{
			id,
			type: nonblank.optional(),
			from: id.optional(),
			to: id.optional(),
			...metadata,
			...stroke,
		},
		({ id, type, from, to, name, description, stroke_color, stroke_opacity }, doc) => ({
			...doc,
			relationships: replace(doc.relationships ?? [], id, "Relationship", (item) => ({
				...item,
				type: type ?? item.type,
				from: from ?? item.from,
				to: to ?? item.to,
				name: patchOptional(item.name, name),
				description: patchOptional(item.description, description),
				source_handle: from != null && from !== item.from ? undefined : item.source_handle,
				target_handle: to != null && to !== item.to ? undefined : item.target_handle,
				stroke_color: patchOptional(item.stroke_color, stroke_color),
				stroke_opacity: patchOptional(item.stroke_opacity, stroke_opacity),
			})),
		}),
	),
	deletion(
		"delete_relationship",
		"Delete an architecture relationship.",
		"relationships",
		({ id }, doc) => ({
			...doc,
			relationships: remove(doc.relationships ?? [], id, "Relationship"),
		}),
	),
	tool(
		"add_group",
		"Add an architecture group. It is not a trust boundary.",
		{ id: nonblank, name: nonblank, type: nonblank.nullish(), description: text },
		({ id, name, type, description }, doc) => ({
			...doc,
			groups: [
				...(doc.groups ?? []),
				{ id, name, type: type ?? undefined, description: description ?? undefined },
			],
		}),
	),
	tool(
		"update_group",
		"Update group metadata without changing geometry or nesting. Use null to clear the type or description.",
		{ id, name: nonblank.optional(), description: text, type: nonblank.nullish() },
		({ id, name, type, description }, doc) => ({
			...doc,
			groups: replace(doc.groups ?? [], id, "Group", (item) => ({
				...item,
				name: name ?? item.name,
				type: patchOptional(item.type, type),
				description: patchOptional(item.description, description),
			})),
		}),
	),
	deletion(
		"delete_group",
		"Delete a group that has no child groups or elements.",
		"groups",
		({ id }, doc) => ({
			...doc,
			groups: remove(doc.groups ?? [], id, "Group", () => {
				if (
					doc.groups?.some((group) => group.parent === id) ||
					doc.elements.some((element) => element.group === id)
				) {
					throw new Error(`Group ${id} still has child groups or elements.`);
				}
			}),
		}),
	),
	tool(
		"add_layer",
		"Append an architecture layer.",
		{ id: nonblank, name: nonblank, description: text },
		({ id, name, description }, doc) => ({
			...doc,
			layers: [...(doc.layers ?? []), { id, name, description: description ?? undefined }],
		}),
	),
	tool(
		"update_layer",
		"Update layer metadata. Use null to clear the description.",
		{ id, name: nonblank.optional(), description: text },
		({ id, name, description }, doc) => ({
			...doc,
			layers: replace(doc.layers ?? [], id, "Layer", (item) => ({
				...item,
				name: name ?? item.name,
				description: patchOptional(item.description, description),
			})),
		}),
	),
	deletion("delete_layer", "Delete a layer that has no elements.", "layers", ({ id }, doc) => ({
		...doc,
		layers: remove(doc.layers ?? [], id, "Layer", () => {
			if (doc.elements.some((element) => element.layer === id)) {
				throw new Error(`Layer ${id} still has elements.`);
			}
		}),
	})),
	tool(
		"reparent_group",
		"Move a group under a parent group ID, or use null to make it a top-level group.",
		{ id, parent: destination },
		({ id, parent }, doc) => ({
			...doc,
			groups: replace(doc.groups ?? [], id, "Group", (item) => ({
				...item,
				parent: parent ?? undefined,
			})),
		}),
	),
	tool(
		"set_element_group",
		"Put an element in a group by ID, or use null to clear the group.",
		{ id, group: destination },
		({ id, group }, doc) => ({
			...doc,
			elements: replace(doc.elements, id, "Element", (item) => ({
				...item,
				group: group ?? undefined,
			})),
		}),
	),
	tool(
		"set_element_layer",
		"Put an element in a layer by ID, or use null to clear the layer.",
		{ id, layer: destination },
		({ id, layer }, doc) => ({
			...doc,
			elements: replace(doc.elements, id, "Element", (item) => ({
				...item,
				layer: layer ?? undefined,
			})),
		}),
	),
];
