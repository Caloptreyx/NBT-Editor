import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AIR, type BlockState } from "../frontend/src/lib/chunk.ts";
import {
	BYTES_PER_QUAD,
	buildLookTable,
	contentBounds,
	FLAG_PLANT,
	type MeshGrid,
	meshSection,
	VERTEX_STRIDE,
} from "../frontend/src/lib/mesh.ts";

const state = (name: string): BlockState => ({
	name: `minecraft:${name}`,
	properties: null,
});
const PALETTE = [
	AIR,
	state("stone"),
	state("glass"),
	state("water"),
	state("poppy"),
	state("oak_leaves"),
	state("cave_air"),
];
const STONE = 1;
const GLASS = 2;
const WATER = 3;
const POPPY = 4;
const LEAVES = 5;
const CAVE_AIR = 6;
const looks = buildLookTable(PALETTE);

function grid(sizeX = 16, height = 16, sizeZ = 16): MeshGrid {
	return { ids: new Uint16Array(sizeX * height * sizeZ), sizeX, sizeZ, height };
}
function put(g: MeshGrid, x: number, y: number, z: number, id: number) {
	g.ids[(y * g.sizeZ + z) * g.sizeX + x] = id;
}
function fill(
	g: MeshGrid,
	from: [number, number, number],
	to: [number, number, number],
	id: number,
) {
	for (let y = from[1]; y <= to[1]; y++)
		for (let z = from[2]; z <= to[2]; z++)
			for (let x = from[0]; x <= to[0]; x++) put(g, x, y, z, id);
}
function mesh(
	g: MeshGrid,
	sliceMin = 0,
	sliceMax = g.height - 1,
	sx = 0,
	sy = 0,
	sz = 0,
) {
	const m = meshSection(g, looks, sliceMin, sliceMax, sx, sy, sz, [0, 0, 0]);
	return {
		...m,
		opaqueQuads: m.opaque.length / BYTES_PER_QUAD,
		translucentQuads: m.translucent.length / BYTES_PER_QUAD,
	};
}
function vertices(bytes: Uint8Array) {
	const f32 = new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		bytes.length / 4,
	);
	const out: { pos: [number, number, number]; shade: number; flags: number }[] =
		[];
	for (let o = 0; o < bytes.length; o += VERTEX_STRIDE) {
		const w = o / 4;
		out.push({
			pos: [f32[w], f32[w + 1], f32[w + 2]],
			shade: bytes[o + 14],
			flags: bytes[o + 15],
		});
	}
	return out;
}

describe("meshSection face culling", () => {
	test("a lone block has six faces, wound counter-clockwise from outside", () => {
		const g = grid();
		put(g, 4, 5, 6, STONE);
		const m = mesh(g);
		assert.equal(m.opaqueQuads, 6);
		assert.equal(m.translucentQuads, 0);
		const v = vertices(m.opaque);
		for (let q = 0; q < v.length; q += 4) {
			const [a, b, c, d] = [v[q].pos, v[q + 1].pos, v[q + 2].pos, v[q + 3].pos];
			const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
			const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
			const normal = [
				e1[1] * e2[2] - e1[2] * e2[1],
				e1[2] * e2[0] - e1[0] * e2[2],
				e1[0] * e2[1] - e1[1] * e2[0],
			];
			const center = [0, 1, 2].map(
				(i) => (a[i] + b[i] + c[i] + d[i]) / 4 - [4.5, 5.5, 6.5][i],
			);
			assert.ok(
				normal[0] * center[0] + normal[1] * center[1] + normal[2] * center[2] >
					0,
				`quad ${q / 4} faces outward`,
			);
		}
	});

	test("directional shading: top brightest, bottom darkest", () => {
		const g = grid();
		put(g, 0, 0, 0, STONE);
		const v = vertices(mesh(g).opaque);
		const shadeOf = (predicate: (p: [number, number, number]) => boolean) => {
			for (let q = 0; q < v.length; q += 4)
				if ([0, 1, 2, 3].every((i) => predicate(v[q + i].pos)))
					return v[q].shade;
			return -1;
		};
		assert.equal(
			shadeOf((p) => p[1] === 1),
			255,
		);
		assert.equal(
			shadeOf((p) => p[1] === 0),
			128,
		);
		assert.equal(
			shadeOf((p) => p[0] === 1),
			204,
		);
		assert.equal(
			shadeOf((p) => p[2] === 1),
			153,
		);
	});

	test("hidden faces between opaque blocks are dropped", () => {
		const g = grid();
		fill(g, [0, 0, 0], [2, 2, 2], STONE);
		assert.equal(mesh(g).opaqueQuads, 54);
		const pair = grid();
		fill(pair, [3, 3, 3], [4, 3, 3], STONE);
		assert.equal(mesh(pair).opaqueQuads, 10);
	});

	test("air variants never draw and never hide faces", () => {
		const g = grid();
		put(g, 1, 1, 1, STONE);
		put(g, 2, 1, 1, CAVE_AIR);
		const m = mesh(g);
		assert.equal(m.opaqueQuads + m.translucentQuads, 6);
	});

	test("transparent blocks keep opaque faces behind them and cull faces against their own type", () => {
		const g = grid();
		put(g, 1, 1, 1, STONE);
		put(g, 2, 1, 1, GLASS);
		const m = mesh(g);
		assert.equal(m.opaqueQuads, 6, "stone face toward glass stays");
		assert.equal(m.translucentQuads, 5, "glass face toward stone is hidden");

		const glass = grid();
		fill(glass, [0, 0, 0], [1, 0, 0], GLASS);
		assert.equal(mesh(glass).translucentQuads, 10);
	});

	test("cutout leaves do not hide neighbours but merge with the same leaves", () => {
		const g = grid();
		put(g, 1, 1, 1, STONE);
		fill(g, [2, 1, 1], [3, 1, 1], LEAVES);
		// stone 6, leaves pair 10 (shared face culled, face toward stone culled -> 9)
		assert.equal(mesh(g).opaqueQuads, 6 + 9);
	});

	test("liquid surfaces sit lower unless the same liquid is above", () => {
		const g = grid();
		fill(g, [0, 0, 0], [0, 1, 0], WATER);
		const m = mesh(g);
		assert.equal(m.translucentQuads, 10);
		const ys = vertices(m.translucent).map((v) => v.pos[1]);
		assert.equal(Math.max(...ys), 1.875);
		assert.ok(ys.every((y) => y === 0 || y === 1 || y === 1.875));
	});

	test("plants are two double-sided crossed quads that cull nothing", () => {
		const g = grid();
		put(g, 1, 1, 1, STONE);
		put(g, 2, 1, 1, POPPY);
		const m = mesh(g);
		assert.equal(m.opaqueQuads, 6 + 4);
		const plantVertices = vertices(m.opaque).filter(
			(v) => v.flags === FLAG_PLANT,
		);
		assert.equal(plantVertices.length, 16);
	});

	test("faces across section borders are culled using the neighbouring section", () => {
		const g = grid(32, 16, 16);
		fill(g, [15, 0, 0], [16, 0, 0], STONE);
		const total = mesh(g, 0, 15, 0).opaqueQuads + mesh(g, 0, 15, 1).opaqueQuads;
		assert.equal(total, 10);
	});
});

describe("meshSection slicing", () => {
	test("blocks outside the slice vanish and the cut plane is closed", () => {
		const g = grid();
		fill(g, [0, 0, 0], [2, 2, 2], STONE);
		assert.equal(mesh(g, 0, 1).opaqueQuads, 9 + 9 + 4 * 6);
		assert.equal(mesh(g, 1, 1).opaqueQuads, 9 + 9 + 4 * 3);
		assert.equal(mesh(g, 5, 15).opaqueQuads, 0);
	});

	test("sections above the slice are empty", () => {
		const g = grid(16, 32, 16);
		fill(g, [0, 0, 0], [0, 31, 0], STONE);
		assert.equal(mesh(g, 0, 10, 0, 1, 0).opaqueQuads, 0);
		assert.equal(
			mesh(g, 0, 20, 0, 1, 0).opaqueQuads,
			4 * 5 + 1,
			"y 16..20 sides plus the cut top",
		);
	});
});

describe("contentBounds", () => {
	test("spans every non-air cell", () => {
		const g = grid();
		put(g, 3, 2, 1, STONE);
		put(g, 7, 9, 4, POPPY);
		put(g, 0, 15, 0, CAVE_AIR);
		assert.deepEqual(contentBounds(g, looks), {
			min: [3, 2, 1],
			max: [8, 10, 5],
		});
		assert.equal(contentBounds(grid(), looks), null);
	});
});
