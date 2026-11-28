import { projectCanvas } from "../src/lib/canvas-projection";
import { parseThreatModelYaml, serializeThreatModelYaml } from "../src/lib/thf-yaml";
import { createDocumentStores } from "../src/stores/document-stores";
import { expect, test } from "./fixtures";
import {
	digest,
	layoutDigest,
	scaleFixture,
	scaleSeed,
	scaleSizes,
	topologies,
} from "./fixtures/gen-scale-workspace.mjs";

test.describe("workspace scale corpus", () => {
	test.skip(!process.env.THREATFORGE_SCALE_EXTENDED, "Opt in to the full topology matrix.");

	for (const size of scaleSizes) {
		for (const topology of topologies) {
			test(`${size} ${topology}, seed ${scaleSeed}`, () => {
				const { thf, fingerprint } = scaleFixture(size, topology);
				const model = parseThreatModelYaml(thf);
				const bulk = model.elements.length - 4;
				const edges = bulk - 1;
				const expected = {
					grid: edges,
					sparse: Math.floor(edges / 4),
					clustered: edges - Math.floor(edges / 12),
					fanout: edges,
					disconnected: 0,
				};
				expect(model.elements).toHaveLength(size);
				expect(model.data_flows).toHaveLength(2 + expected[topology as keyof typeof expected]);
				expect(new Set(model.elements.map(({ id }) => id)).size).toBe(size);
				const pairs = model.data_flows.map(({ from, to }) => [from, to]);
				expect(new Set(pairs.map(([from, to]) => `${from}/${to}`)).size).toBe(pairs.length);
				if (topology === "fanout") {
					expect(model.data_flows.filter(({ from }) => from === "bulk-0000")).toHaveLength(edges);
				}
				const canonical = serializeThreatModelYaml(model);
				expect(digest(parseThreatModelYaml(canonical))).toBe(digest(model));
				expect(layoutDigest(model)).toBe(fingerprint.layoutDigest);
				expect(scaleFixture(size, topology).fingerprint).toEqual(fingerprint);
				const projection = projectCanvas(model, { nodes: [], edges: [] }, null);
				expect(projection.nodes.map(({ id }) => id)).toEqual(
					expect.arrayContaining(model.elements.map(({ id }) => id)),
				);
				expect(projection.edges.map(({ id }) => id)).toEqual(
					expect.arrayContaining(model.data_flows.map(({ id }) => id)),
				);
				console.log(JSON.stringify(fingerprint));
			});
		}
	}

	test("replays 1000 edits across 10 independent documents and retains only 20 undo steps each", () => {
		const { thf } = scaleFixture(1000, "sparse");
		const initial = parseThreatModelYaml(thf);
		const documents = Array.from({ length: 10 }, () => createDocumentStores());
		const expected = documents.map(() => structuredClone(initial));
		for (const document of documents) document.model.getState().setModel(initial, null);
		for (let step = 0; step < 1000; step++) {
			const index = step % documents.length;
			const elementIndex = 4 + ((step * 17) % (initial.elements.length - 4));
			const { id } = initial.elements[elementIndex];
			const name = `Edit ${step}`;
			const store = documents[index].model.getState();
			store.resetCaptureDebounce();
			store.updateElement(id, { name });
			expected[index].elements[elementIndex].name = name;
			expect(digest(documents[index].model.getState().model)).toBe(digest(expected[index]));
		}
		for (const [index, { model, history }] of documents.entries()) {
			const final = model.getState().model;
			expect(digest(final)).toBe(digest(expected[index]));
			expect(history.getState().past).toHaveLength(20);
			for (let step = 0; step < 20; step++) {
				const current = model.getState().model;
				if (!current) throw new Error("Missing replay document");
				const undone = history.getState().undo(current);
				if (!undone) throw new Error("Expected a replay undo step");
				model.getState().restoreSnapshot(undone);
			}
			expect(history.getState().canUndo()).toBe(false);
			expect(history.getState().future).toHaveLength(20);
			for (let step = 0; step < 20; step++) {
				const current = model.getState().model;
				if (!current) throw new Error("Missing replay document");
				const redone = history.getState().redo(current);
				if (!redone) throw new Error("Expected a replay redo step");
				model.getState().restoreSnapshot(redone);
			}
			expect(digest(model.getState().model)).toBe(digest(final));
			expect(history.getState().canRedo()).toBe(false);
		}
	});
});

test("reports scale timings without enforcing budgets", () => {
	test.skip(!process.env.THREATFORGE_SCALE_TIMING, "Opt in to timing measurements.");
	for (const size of scaleSizes) {
		const { thf, fingerprint } = scaleFixture(size, "sparse");
		const start = performance.now();
		const model = parseThreatModelYaml(thf);
		const loaded = performance.now();
		projectCanvas(model, { nodes: [], edges: [] }, null);
		const projected = performance.now();
		const saved = serializeThreatModelYaml(model);
		const finished = performance.now();
		expect(parseThreatModelYaml(saved).elements).toHaveLength(size);
		console.log(
			JSON.stringify({
				...fingerprint,
				node: process.version,
				platform: `${process.platform}-${process.arch}`,
				readMs: loaded - start,
				projectMs: projected - loaded,
				writeMs: finished - projected,
			}),
		);
	}
});
