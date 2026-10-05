# NBT Editor

A [Calagopus Panel](https://calagopus.com) extension that lets you look inside a Minecraft world from the server's
**NBT Editor** page: browse region files as a chunk map, inspect chunks in 3D, edit blocks and NBT data, and prune
chunks you no longer need.

Package name: `dev.caloptreyx.nbteditor` · Requires panel `>=1.2.3`

## Features

- **File browser** for region (`.mca`, `.mcr`) and NBT files (`.dat`, `.dat_old`, `.nbt`, `.schem`, `.schematic`,
  `.litematic`), with a Worlds strip that finds every world with a `level.dat` and links to its dimensions. Old
  (`region`, `DIM-1`, `DIM1`), Bukkit (`world_nether`, `world_the_end`) and the newer `dimensions/<ns>/<name>` layouts are
  recognised.
- **NBT tree editor**: gzip, zlib or uncompressed Java files and Bedrock little-endian `level.dat`, saved back in the same
  format. Edit values with validation, rename, add, duplicate, reorder and delete tags, edit arrays as text, filter, and
  copy SNBT.
- **Region map**: the 32x32 chunks of a region drawn from above, with status, InhabitedTime, last update, size and
  compression on hover. Click, shift-click or drag to select chunks.
- **Chunk Inspector**: up to 9 chunks in a WebGL2 3D view. Left-drag to spin, middle-drag or Q/E to tilt, right-drag to
  pan, scroll to zoom, WASD/arrow keys to move, R to reset. Hover for block details, select a block to see its state and
  block entity NBT, remove or replace it, or paint-delete by dragging. A Y range slider cuts the view open and block
  search highlights every match.
- **Pruning**: delete selected chunks, or every chunk in a region or whole dimension that matches criteria
  (InhabitedTime below a limit, not fully generated, outside a square or circular radius). A scan shows what would go
  first. The same chunks are removed from the `entities/` and `poi/` region files next to the region.
- **Safe writes**: everything is parsed in the browser and the backend only moves bytes through Wings, so saves create
  file revisions, show up in the activity log and respect subuser ignored files. A save is refused when the file changed
  since it was opened, unless you choose to overwrite.

## Notes

- Region saves and pruning are only available while the server is offline: a running server keeps region files cached
  and would overwrite the changes.
- Chunks from Minecraft 1.13 and newer can be edited; older chunks (numeric block ids) open read only.
- After a block edit the chunk's heightmaps are dropped and `isLightOn` is cleared so the game recalculates them on load.
- Blocks are drawn with generated colors and a pixel noise pattern, not Minecraft's textures.

## Permissions

| Action | Permission |
|---|---|
| Open the page and files | `files.read-content` |
| List directories | `files.read` |
| Save, delete or prune | `files.create` |

## Development

Frontend checks from the panel's `frontend` directory:
`./node_modules/.bin/tsc -p tsconfig.json --noEmit` and
`./node_modules/.bin/biome check extensions/dev_caloptreyx_nbteditor`. Library tests from this repository:
`node --test tests/*.test.ts`. The backend is built and tested by CI (`.github/workflows/check.yml`).
`python3 scripts/package.py` builds `dist/dev_caloptreyx_nbteditor.c7s.zip`.

## License

MIT
