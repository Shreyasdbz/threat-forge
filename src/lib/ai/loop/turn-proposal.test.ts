import { describe, expect, it } from "vitest";
import { createAiToolRegistry } from "@/lib/ai/tools/tool-registry";
import type { ThreatModel } from "@/types/threat-model";
import { createTurnProposal } from "./turn-proposal";

const registry = createAiToolRegistry();
const signal = new AbortController().signal;
const baseline: ThreatModel = {
	version: "1.0",
	metadata: {
		title: "Proposal",
		author: "",
		description: "",
		created: "2026-01-01",
		modified: "2026-01-01",
	},
	elements: [],
	data_flows: [],
	trust_boundaries: [],
	threats: [],
	diagrams: [],
};

function stage(
	proposal: ReturnType<typeof createTurnProposal>,
	id: string,
	name: string,
	input: object,
) {
	const tool = registry.get(name);
	const prepared = tool?.prepare({ action: name, ...input });
	if (!tool || !prepared?.ok) throw new Error("Could not prepare test tool");
	return proposal.run(tool, id, prepared.call, signal);
}

describe("whole-turn draft", () => {
	it("preserves generated IDs and blocks an included operation with a missing dependency", async () => {
		const proposal = createTurnProposal(baseline);
		for (const name of ["client", "service", "independent"]) {
			expect(
				await stage(proposal, name, "add_element", { element: { name, type: "process" } }),
			).toMatchObject({ status: "ok" });
		}
		const [client, service, independent] = proposal.getDocument().elements;
		expect(
			await stage(proposal, "flow", "add_data_flow", {
				data_flow: { from: client.id, to: service.id, name: "Request" },
			}),
		).toMatchObject({ status: "ok" });
		const full = proposal.finish();
		if (!full) throw new Error("Could not review test proposal");
		expect(full.changes.map(({ id, kind }) => [id, kind])).toEqual([
			[client.id, "added"],
			[service.id, "added"],
			[independent.id, "added"],
			["flow-1", "added"],
		]);
		expect(baseline.elements).toEqual([]);

		const blocked = await proposal.select(
			full.token,
			new Set(["service", "independent", "flow"]),
			signal,
		);
		if (!blocked) throw new Error("No blocked candidate");
		expect(blocked.blocked?.reason).toMatch(/endpoints/i);
		expect(proposal.take(full.token)).toBeNull();
		expect(proposal.take(blocked.token)).toBeNull();

		const subset = await proposal.select(blocked.token, new Set(["independent"]), signal);
		if (!subset) throw new Error("No subset candidate");
		expect(subset.blocked).toBeNull();
		expect(subset.changes.map(({ id }) => id)).toEqual([independent.id]);
		expect(proposal.take(subset.token)?.elements.map(({ id }) => id)).toEqual([independent.id]);
		expect(proposal.take(subset.token)).toBeNull();
	});

	it("shows cascaded deletions and the before/after values of connected objects", async () => {
		const client = {
			id: "client",
			name: "Client",
			type: "process",
			trust_zone: "internal",
			description: "",
			technologies: [],
		} as const;
		const document: ThreatModel = {
			...baseline,
			elements: [
				{ ...client, technologies: [] },
				{ ...client, id: "service", name: "Service", technologies: [] },
			],
			data_flows: [
				{
					id: "request",
					name: "Request",
					from: "client",
					to: "service",
					protocol: "",
					data: [],
					authenticated: false,
				},
			],
			trust_boundaries: [{ id: "network", name: "Network", contains: ["client", "service"] }],
		};
		const proposal = createTurnProposal(document);
		expect(await stage(proposal, "delete", "delete_element", { id: "client" })).toMatchObject({
			status: "ok",
		});
		expect(proposal.finish()?.changes).toMatchObject([
			{ id: "client", kind: "removed" },
			{ id: "request", kind: "removed" },
			{
				id: "network",
				kind: "modified",
				fields: [{ field: "contains", before: ["client", "service"], after: ["service"] }],
			},
		]);
		expect(document.data_flows).toHaveLength(1);
	});
});
