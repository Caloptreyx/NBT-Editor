import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	AIR,
	type BlockState,
	type ChunkModel,
	getBlock,
	setBlock,
} from "../frontend/src/lib/chunk.ts";
import { compound } from "../frontend/src/lib/nbt.ts";
import {
	buildVolume,
	findInVolume,
	setVolumeBlock,
	volumeBlock,
	volumeSectionCounts,
	volumeSectionVersions,
} from "../frontend/src/lib/volume.ts";

const STONE: BlockState = { name: "minecraft:stone", properties: null };
const DIAMOND: BlockState = { name: "minecraft:diamond_ore", properties: null };
const STAIRS: BlockState = {
	name: "minecraft:oak_stairs",
	properties: { facing: "north", half: "bottom" },
};

function chunk(
	x: number,
	z: number,
	minY = -64,
	maxY = 319,
	editable = true,
): ChunkModel {
	return {
		doc: { name: "", root: compound() },
		dataVersion: 3953,
		x,
		z,
		minY,
		maxY,
		sections: new Map(),
		status: "minecraft:full",
		inhabitedTime: 0n,
		lastUpdate: 0n,
		editable,
		readOnlyReason: editable ? null : "read only",
		dirty: false,
	};
}

describe("buildVolume", () => {
	test("covers the bounding box of non-adjacent chunks with negative coordinates", () => {
		const a = chunk(-1, 0);
		const b = chunk(1, 1);
		setBlock(a, 15, -64, 0, STONE); // absolute (-1, -64, 0)
		setBlock(b, 0, 319, 15, DIAMOND); // absolute (16, 319, 31)
		const v = buildVolume([a, b]);
		assert.equal(v.originX, -16);
		assert.equal(v.originZ, 0);
		assert.equal(v.sizeX, 48);
		assert.equal(v.sizeZ, 32);
		assert.equal(v.minY, -64);
		assert.equal(v.height, 384);
		assert.equal(v.palette[0], AIR);

		const index = (x: number, y: number, z: number) =>
			((y - v.minY) * v.sizeZ + (z - v.originZ)) * v.sizeX + (x - v.originX);
		assert.equal(v.palette[v.ids[index(-1, -64, 0)]].name, STONE.name);
		assert.equal(v.palette[v.ids[index(16, 319, 31)]].name, DIAMOND.name);
		assert.equal(volumeBlock(v, -1, -64, 0).name, STONE.name);
		assert.equal(volumeBlock(v, 16, 319, 31).name, DIAMOND.name);
		// the gap chunk (0, 0) and positions outside the volume are air
		assert.equal(volumeBlock(v, 5, 0, 5), AIR);
		assert.equal(volumeBlock(v, -17, 0, 0), AIR);
		assert.equal(volumeBlock(v, 0, 320, 0), AIR);
	});

	test("expands single-state sections without data and spans chunks of different heights", () => {
		const modern = chunk(0, 0);
		const legacy = chunk(1, 0, 0, 255);
		legacy.sections.set(2, { y: 2, palette: [STONE], data: null });
		const v = buildVolume([modern, legacy]);
		assert.equal(v.minY, -64);
		assert.equal(v.height, 384);
		let stones = 0;
		for (let y = 32; y < 48; y++) {
			for (let z = 0; z < 16; z++) {
				for (let x = 16; x < 32; x++)
					if (volumeBlock(v, x, y, z).name === STONE.name) stones++;
			}
		}
		assert.equal(stones, 4096);
		assert.equal(volumeBlock(v, 16, 31, 0), AIR);
		assert.equal(volumeBlock(v, 16, 48, 0), AIR);
	});
});

describe("setVolumeBlock", () => {
	test("updates the grid and the owning chunk model", () => {
		const a = chunk(-1, -1);
		const v = buildVolume([a]);
		assert.equal(setVolumeBlock(v, -3, 70, -16, STAIRS), true);
		assert.deepEqual(volumeBlock(v, -3, 70, -16), STAIRS);
		assert.deepEqual(getBlock(a, 13, 70, 0), STAIRS);
		assert.equal(a.dirty, true);

		const paletteSize = v.palette.length;
		assert.equal(
			setVolumeBlock(v, -4, 70, -16, {
				name: "minecraft:oak_stairs",
				properties: { half: "bottom", facing: "north" },
			}),
			true,
		);
		assert.equal(
			v.palette.length,
			paletteSize,
			"equal states share one palette id",
		);

		assert.equal(setVolumeBlock(v, -3, 70, -16, AIR), true);
		assert.equal(volumeBlock(v, -3, 70, -16), AIR);
		assert.equal(getBlock(a, 13, 70, 0).name, AIR.name);
	});

	test("refuses positions outside the volume, in gaps and in read-only chunks", () => {
		const a = chunk(0, 0);
		const locked = chunk(2, 0, -64, 319, false);
		const v = buildVolume([a, locked]);
		assert.equal(setVolumeBlock(v, 20, 0, 0, STONE), false, "gap chunk");
		assert.equal(setVolumeBlock(v, 33, 0, 0, STONE), false, "read-only chunk");
		assert.equal(volumeBlock(v, 33, 0, 0), AIR);
		assert.equal(
			setVolumeBlock(v, 0, 320, 0, STONE),
			false,
			"above the volume",
		);
		assert.equal(
			setVolumeBlock(v, -1, 0, 0, STONE),
			false,
			"west of the volume",
		);
	});

	test("bumps the section version of the block and of bordering sections", () => {
		const v = buildVolume([chunk(0, 0), chunk(1, 0)]);
		const counts = volumeSectionCounts(v);
		assert.deepEqual(counts, { x: 2, y: 24, z: 1 });
		const versions = volumeSectionVersions(v);
		const at = (sx: number, sy: number, sz: number) =>
			versions[(sy * counts.z + sz) * counts.x + sx];

		setVolumeBlock(v, 5, 5, 5, STONE); // interior of section (0, 4, 0)
		assert.equal(at(0, 4, 0), 1);
		assert.equal(at(1, 4, 0), 0);
		assert.equal(at(0, 5, 0), 0);

		setVolumeBlock(v, 15, -49, 3, STONE); // relative y 15: borders x+1 and y+1 neighbours
		assert.equal(at(0, 0, 0), 1);
		assert.equal(at(1, 0, 0), 1);
		assert.equal(at(0, 1, 0), 1);
		assert.equal(at(1, 1, 0), 0);
	});
});

describe("findInVolume", () => {
	test("matches ids and state keys case-insensitively, ordered by y, z, x", () => {
		const a = chunk(-1, 0);
		setBlock(a, 2, 10, 1, DIAMOND);
		setBlock(a, 1, 10, 1, DIAMOND);
		setBlock(a, 0, 5, 0, {
			name: "minecraft:deepslate_diamond_ore",
			properties: null,
		});
		setBlock(a, 3, 3, 3, STAIRS);
		const v = buildVolume([a]);
		assert.deepEqual(findInVolume(v, "Diamond_Ore"), [
			{ x: -16, y: 5, z: 0 },
			{ x: -15, y: 10, z: 1 },
			{ x: -14, y: 10, z: 1 },
		]);
		assert.deepEqual(findInVolume(v, "minecraft:diamond_ore"), [
			{ x: -15, y: 10, z: 1 },
			{ x: -14, y: 10, z: 1 },
		]);
		assert.deepEqual(findInVolume(v, "facing=north"), [{ x: -13, y: 3, z: 3 }]);
		assert.deepEqual(findInVolume(v, "minecraft:air"), []);
		assert.deepEqual(findInVolume(v, "   "), []);
	});
});
