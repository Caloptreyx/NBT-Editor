import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { blockLook } from "../frontend/src/lib/blockColors.ts";

describe("blockLook kinds", () => {
	test("air-like blocks are air, with or without namespace", () => {
		for (const name of [
			"air",
			"cave_air",
			"void_air",
			"light",
			"structure_void",
			"barrier",
		]) {
			assert.equal(blockLook(`minecraft:${name}`).kind, "air", name);
			assert.equal(blockLook(name).kind, "air", name);
		}
	});

	test("render classes of common blocks", () => {
		const expected: Record<string, string> = {
			"minecraft:stone": "solid",
			"minecraft:grass_block": "solid",
			"minecraft:deepslate_diamond_ore": "solid",
			"minecraft:glass": "transparent",
			"minecraft:red_stained_glass_pane": "transparent",
			"minecraft:ice": "transparent",
			"minecraft:water": "liquid",
			"minecraft:lava": "liquid",
			"minecraft:oak_leaves": "cutout",
			"minecraft:cherry_leaves": "cutout",
			"minecraft:poppy": "plant",
			"minecraft:short_grass": "plant",
			"minecraft:wheat": "plant",
			"minecraft:torch": "plant",
			"minecraft:wall_torch": "plant",
			"minecraft:powered_rail": "plant",
			"minecraft:oak_sapling": "plant",
			"minecraft:potted_poppy": "plant",
			"minecraft:brain_coral_fan": "plant",
			"minecraft:brain_coral_block": "solid",
			"minecraft:oak_fence": "cutout",
			"minecraft:spruce_door": "cutout",
			"minecraft:oak_stairs": "solid",
		};
		for (const [name, kind] of Object.entries(expected))
			assert.equal(blockLook(name).kind, kind, name);
	});
});

describe("blockLook colors", () => {
	test("shapes take the color of their base material", () => {
		const same = (shape: string, base: string) =>
			assert.deepEqual(
				blockLook(`minecraft:${shape}`).color,
				blockLook(`minecraft:${base}`).color,
				shape,
			);
		same("oak_stairs", "oak_planks");
		same("mangrove_slab", "mangrove_planks");
		same("pale_oak_wall_hanging_sign", "pale_oak_planks");
		same("stone_brick_wall", "stone_bricks");
		same("deepslate_tile_stairs", "deepslate_tiles");
		same("quartz_slab", "quartz_block");
		same("waxed_weathered_cut_copper_stairs", "weathered_cut_copper");
		same("infested_cobblestone", "cobblestone");
		same("lime_carpet", "lime_wool");
	});

	test("dye colors differ per material and per color", () => {
		const red = blockLook("minecraft:red_concrete").color;
		assert.notDeepEqual(red, blockLook("minecraft:red_wool").color);
		assert.notDeepEqual(red, blockLook("minecraft:blue_concrete").color);
		assert.notDeepEqual(
			blockLook("minecraft:light_blue_wool").color,
			blockLook("minecraft:blue_wool").color,
		);
		assert.ok(red[0] > red[2], "red concrete is red");
	});

	test("grass is green on top with earthy sides; logs show bark on the side", () => {
		const grass = blockLook("minecraft:grass_block");
		assert.ok(
			grass.color[1] > grass.color[0] && grass.color[1] > grass.color[2],
		);
		assert.ok(grass.side && grass.side[0] > grass.side[2]);
		const birch = blockLook("minecraft:birch_log");
		assert.ok(
			birch.side && birch.side[0] > birch.color[0],
			"birch bark is lighter than its rings",
		);
	});

	test("unknown blocks get a stable color from heuristics or a hash", () => {
		const modded = blockLook("somemod:strange_machine");
		assert.equal(modded.kind, "solid");
		assert.ok(
			modded.color.every((c) => Number.isInteger(c) && c >= 0 && c <= 255),
		);
		assert.notDeepEqual(modded.color, blockLook("somemod:other_machine").color);
		assert.equal(blockLook("somemod:fancy_glass").kind, "transparent");
		assert.equal(blockLook("somemod:maple_leaves").kind, "cutout");
		assert.deepEqual(
			blockLook("somemod:polished_deepslate_thing").color,
			[0x48, 0x48, 0x4a],
		);
	});
});
