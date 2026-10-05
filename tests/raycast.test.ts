import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	cameraEye,
	cameraRay,
	fitCamera,
	type OrbitCamera,
	viewProjection,
} from "../frontend/src/lib/camera.ts";
import {
	AIR,
	type BlockState,
	type ChunkModel,
	setBlock,
} from "../frontend/src/lib/chunk.ts";
import { buildLookTable } from "../frontend/src/lib/mesh.ts";
import { compound } from "../frontend/src/lib/nbt.ts";
import { pickBlock, raycastGrid } from "../frontend/src/lib/raycast.ts";
import { buildVolume } from "../frontend/src/lib/volume.ts";

const normalize = (v: [number, number, number]): [number, number, number] => {
	const l = Math.hypot(...v);
	return [v[0] / l, v[1] / l, v[2] / l];
};

describe("raycastGrid", () => {
	const size = [8, 8, 8] as const;
	const only =
		(...cells: [number, number, number][]) =>
		(x: number, y: number, z: number) =>
			cells.some((c) => c[0] === x && c[1] === y && c[2] === z);

	test("enters the grid from outside and reports the entered face", () => {
		const hit = raycastGrid(size, [2.5, 3.5, 20], [0, 0, -1], only([2, 3, 4]));
		assert.deepEqual(
			hit && { x: hit.x, y: hit.y, z: hit.z, normal: hit.normal },
			{ x: 2, y: 3, z: 4, normal: [0, 0, 1] },
		);
		assert.ok(hit && Math.abs(hit.distance - 15) < 1e-9);

		const fromBelow = raycastGrid(
			size,
			[1.5, -5, 1.5],
			[0, 1, 0],
			only([1, 6, 1]),
		);
		assert.deepEqual(fromBelow?.normal, [0, -1, 0]);
		assert.equal(fromBelow?.y, 6);
	});

	test("a cell on the far face of the grid is reachable when entering through a max face", () => {
		const hit = raycastGrid(size, [9, 0.5, 0.5], [-1, 0, 0], only([7, 0, 0]));
		assert.deepEqual(hit && [hit.x, hit.normal], [7, [1, 0, 0]]);
	});

	test("walks diagonals cell by cell and stops at the first hit", () => {
		const dir = normalize([1, 1, 1]);
		const hit = raycastGrid(
			size,
			[0.5, 0.5, 0.2],
			dir,
			only([3, 3, 3], [5, 5, 5]),
		);
		assert.deepEqual(hit && [hit.x, hit.y, hit.z], [3, 3, 3]);
	});

	test("starting inside a solid cell hits it with a zero normal", () => {
		const hit = raycastGrid(size, [4.5, 4.5, 4.5], [1, 0, 0], only([4, 4, 4]));
		assert.deepEqual(hit && [hit.x, hit.normal], [4, [0, 0, 0]]);
	});

	test("misses return null, including beyond maxDistance and rays pointing away", () => {
		assert.equal(
			raycastGrid(size, [2.5, 3.5, 20], [0, 0, 1], only([2, 3, 4])),
			null,
		);
		assert.equal(
			raycastGrid(size, [2.5, 3.5, 20], [0, 0, -1], only([2, 3, 4]), 10),
			null,
		);
		assert.equal(
			raycastGrid(size, [20, 20, 20], [0, 0, -1], () => true),
			null,
		);
	});
});

describe("pickBlock", () => {
	const STONE: BlockState = { name: "minecraft:stone", properties: null };
	function chunk(x: number, z: number): ChunkModel {
		return {
			doc: { name: "", root: compound() },
			dataVersion: 3953,
			x,
			z,
			minY: -64,
			maxY: 319,
			sections: new Map(),
			status: null,
			inhabitedTime: 0n,
			lastUpdate: 0n,
			editable: true,
			readOnlyReason: null,
			dirty: false,
		};
	}

	test("returns absolute coordinates in negative chunks and respects the Y slice", () => {
		const a = chunk(-1, -1);
		setBlock(a, 11, -60, 13, STONE); // absolute (-5, -60, -3)
		setBlock(a, 11, -61, 13, STONE); // absolute (-5, -61, -3)
		setBlock(a, 11, -59, 13, { name: "minecraft:cave_air", properties: null });
		const v = buildVolume([a]);
		const kinds = buildLookTable(v.palette).kinds;

		const side = pickBlock(v, kinds, [-4.5, -59.5, 5], [0, 0, -1], -64, 319);
		assert.deepEqual(side, {
			x: -5,
			y: -60,
			z: -3,
			normal: [0, 0, 1],
			distance: 7,
		});

		const down = pickBlock(v, kinds, [-4.5, 100, -2.5], [0, -1, 0], -64, 319);
		assert.deepEqual(down && [down.y, down.normal], [-60, [0, 1, 0]]);

		const sliced = pickBlock(v, kinds, [-4.5, 100, -2.5], [0, -1, 0], -64, -61);
		assert.deepEqual(sliced && [sliced.x, sliced.y, sliced.z], [-5, -61, -3]);

		assert.equal(
			pickBlock(v, kinds, [-4.5, 100, -2.5], [0, -1, 0], -64, -62),
			null,
		);
		assert.equal(v.palette[0], AIR);
	});
});

describe("orbit camera", () => {
	const project = (m: Float32Array, p: [number, number, number]) => {
		const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
		const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
		const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
		const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
		return [x / w, y / w, z / w];
	};

	test("picking rays agree with the projection matrix", () => {
		const camera: OrbitCamera = {
			target: [10, 20, -5],
			yaw: 1.1,
			pitch: 0.4,
			distance: 30,
		};
		const aspect = 1.6;
		const m = viewProjection(camera, aspect);
		for (const [nx, ny] of [
			[0, 0],
			[0.5, -0.25],
			[-0.9, 0.8],
		]) {
			const ray = cameraRay(camera, aspect, nx, ny);
			assert.deepEqual(ray.origin, cameraEye(camera));
			const point: [number, number, number] = [0, 1, 2].map(
				(i) => ray.origin[i] + ray.dir[i] * 25,
			) as [number, number, number];
			const [px, py, pz] = project(m, point);
			assert.ok(
				Math.abs(px - nx) < 1e-4 && Math.abs(py - ny) < 1e-4,
				`ndc ${px},${py} vs ${nx},${ny}`,
			);
			assert.ok(pz > -1 && pz < 1);
		}
	});

	test("fitCamera keeps every corner of the box on screen", () => {
		const min: [number, number, number] = [0, 0, 0];
		const max: [number, number, number] = [48, 180, 48];
		for (const aspect of [0.6, 1, 2.4]) {
			const m = viewProjection(fitCamera(min, max, aspect), aspect);
			for (let corner = 0; corner < 8; corner++) {
				const p: [number, number, number] = [
					corner & 1 ? max[0] : min[0],
					corner & 2 ? max[1] : min[1],
					corner & 4 ? max[2] : min[2],
				];
				const [x, y, z] = project(m, p);
				assert.ok(
					Math.abs(x) <= 1 && Math.abs(y) <= 1 && z > -1 && z < 1,
					`corner ${corner} at aspect ${aspect}`,
				);
			}
		}
	});
});
