import type { BlockPos } from './VoxelViewport.tsx';
import {
  cameraEye,
  cameraRay,
  clampCamera,
  fitCamera,
  type OrbitCamera,
  type Vec3,
  viewProjection,
} from '../lib/camera.ts';
import { buildLookTable, contentBounds, type LookTable, meshSection, VERTEX_STRIDE } from '../lib/mesh.ts';
import { type BlockHit, pickBlock } from '../lib/raycast.ts';
import { type Volume, volumeSectionCounts, volumeSectionVersions } from '../lib/volume.ts';

const BACKGROUND = [0x11 / 255, 0x13 / 255, 0x1a / 255] as const;
const MESH_BUDGET_MS = 10;
const MAX_HIGHLIGHT_BOXES = 20000;
const FOCUS_DURATION_MS = 320;
const FOCUS_MAX_DISTANCE = 48;

const MESH_VS = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec4 a_uvsf;
layout(location = 2) in vec4 a_color;
layout(location = 3) in uint a_seed;
uniform mat4 u_viewProj;
out vec2 v_uv;
out vec4 v_color;
flat out uint v_seed;
flat out uint v_flags;
void main() {
  v_uv = a_uvsf.xy;
  v_color = vec4(a_color.rgb * (a_uvsf.z / 255.0), a_color.a);
  v_seed = a_seed;
  v_flags = uint(a_uvsf.w);
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
in vec4 v_color;
flat in uint v_seed;
flat in uint v_flags;
out vec4 o_color;
uint hash(uint x) {
  x ^= x >> 16; x *= 0x7feb352du;
  x ^= x >> 15; x *= 0x846ca68bu;
  x ^= x >> 16;
  return x;
}
void main() {
  uvec2 texel = uvec2(clamp(floor(v_uv), 0.0, 15.0));
  uint h = hash(v_seed ^ ((texel.x + texel.y * 16u) * 0x9e3779b9u));
  float n = float(h & 1023u) / 1023.0;
  if ((v_flags & 1u) != 0u && n < 0.16) discard;
  if ((v_flags & 2u) != 0u && n < 0.4) discard;
  float grain = 0.86 + 0.26 * n;
  o_color = vec4(v_color.rgb * grain, v_color.a);
}`;

const LINE_VS = `#version 300 es
layout(location = 0) in vec3 a_pos;
uniform mat4 u_viewProj;
void main() { gl_Position = u_viewProj * vec4(a_pos, 1.0); }`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o_color;
void main() { o_color = u_color; }`;

// 12 box edges as corner index pairs over corners ordered (x, y, z) bits.
const BOX_EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];

function pushBox(out: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
  for (const corner of BOX_EDGES) {
    out.push(corner & 1 ? x1 : x0, corner & 2 ? y1 : y0, corner & 4 ? z1 : z0);
  }
}

interface SectionGpu {
  opaque: WebGLBuffer | null;
  opaqueQuads: number;
  translucent: WebGLBuffer | null;
  translucentQuads: number;
}

interface GlResources {
  meshProgram: WebGLProgram;
  meshViewProj: WebGLUniformLocation | null;
  lineProgram: WebGLProgram;
  lineViewProj: WebGLUniformLocation | null;
  lineColor: WebGLUniformLocation | null;
  meshVao: WebGLVertexArrayObject;
  indexBuffer: WebGLBuffer;
  indexCapacity: number; // quads
  lineVao: WebGLVertexArrayObject;
  gridBuffer: WebGLBuffer;
  highlightBuffer: WebGLBuffer;
  overlayBuffer: WebGLBuffer;
}

interface FocusAnimation {
  from: Vec3;
  to: Vec3;
  fromDistance: number;
  toDistance: number;
  start: number;
}

export interface RendererHooks {
  /** Called before each frame with the elapsed seconds; return true to keep animating (held keys). */
  beforeFrame(dt: number): boolean;
  onContextLost(lost: boolean): void;
}

/** Raw WebGL2 renderer for a Volume: per-section meshes, line overlays, orbit camera and CPU picking. */
export class VoxelRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly camera: OrbitCamera = { target: [0, 0, 0], yaw: Math.PI / 4, pitch: 0.6, distance: 64 };
  private readonly gl: WebGL2RenderingContext;
  private readonly hooks: RendererHooks;
  private res: GlResources | null = null;
  private lost = false;
  private disposed = false;
  private frame = 0;
  private lastFrameTime = 0;
  private readonly viewProj = new Float32Array(16);

  private volume: Volume | null = null;
  private boundsKey = '';
  private looks: LookTable | null = null;
  private counts = { x: 0, y: 0, z: 0 };
  private sections: SectionGpu[] = [];
  private knownVersions = new Uint32Array(0);
  private dirty = new Uint8Array(0);
  private queue: number[] = [];
  private content: { min: Vec3; max: Vec3 } | null = null;
  private sliceMin = 0; // grid-relative, inclusive
  private sliceMax = -1;

  private highlights: readonly BlockPos[] = [];
  private highlightVertices = 0;
  private gridVertices = 0;
  private selected: BlockPos | null = null;
  private hover: BlockPos | null = null;
  private overlaySelectedVertices = 0;
  private overlayHoverVertices = 0;
  private focusAnimation: FocusAnimation | null = null;

  constructor(canvas: HTMLCanvasElement, hooks: RendererHooks) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    this.canvas = canvas;
    this.gl = gl;
    this.hooks = hooks;
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    this.res = this.createResources();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.releaseResources();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.res = null;
    for (const section of this.sections) {
      section.opaque = null;
      section.translucent = null;
    }
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.hooks.onContextLost(true);
  };

  private handleContextRestored = () => {
    this.lost = false;
    this.res = this.createResources();
    this.sections = this.sections.map(() => ({ opaque: null, opaqueQuads: 0, translucent: null, translucentQuads: 0 }));
    this.markAllDirty();
    this.rebuildGrid();
    this.rebuildHighlights();
    this.rebuildOverlay();
    this.hooks.onContextLost(false);
    this.requestRender();
  };

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Could not create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile failed: ${log}`);
    }
    return shader;
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    const vertex = this.compile(gl.VERTEX_SHADER, vs);
    const fragment = this.compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${log}`);
    }
    return program;
  }

  private createResources(): GlResources {
    const gl = this.gl;
    const meshProgram = this.link(MESH_VS, MESH_FS);
    const lineProgram = this.link(LINE_VS, LINE_FS);
    const meshVao = gl.createVertexArray();
    const indexBuffer = gl.createBuffer();
    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    for (let location = 0; location < 4; location++) gl.enableVertexAttribArray(location);
    gl.bindVertexArray(null);

    const lineVao = gl.createVertexArray();
    gl.bindVertexArray(lineVao);
    gl.enableVertexAttribArray(0);
    gl.bindVertexArray(null);

    return {
      meshProgram,
      meshViewProj: gl.getUniformLocation(meshProgram, 'u_viewProj'),
      lineProgram,
      lineViewProj: gl.getUniformLocation(lineProgram, 'u_viewProj'),
      lineColor: gl.getUniformLocation(lineProgram, 'u_color'),
      meshVao,
      indexBuffer,
      indexCapacity: 0,
      lineVao,
      gridBuffer: gl.createBuffer(),
      highlightBuffer: gl.createBuffer(),
      overlayBuffer: gl.createBuffer(),
    };
  }

  private releaseResources() {
    const gl = this.gl;
    const res = this.res;
    this.res = null;
    if (!res || this.lost) return;
    for (const section of this.sections) {
      if (section.opaque) gl.deleteBuffer(section.opaque);
      if (section.translucent) gl.deleteBuffer(section.translucent);
    }
    this.sections = [];
    gl.deleteProgram(res.meshProgram);
    gl.deleteProgram(res.lineProgram);
    gl.deleteVertexArray(res.meshVao);
    gl.deleteVertexArray(res.lineVao);
    for (const buffer of [res.indexBuffer, res.gridBuffer, res.highlightBuffer, res.overlayBuffer]) {
      gl.deleteBuffer(buffer);
    }
  }

  get contextLost(): boolean {
    return this.lost;
  }

  /** Canvas backing size in device pixels; `pixelRatio` is capped by the caller. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number) {
    const width = Math.max(1, Math.round(cssWidth * pixelRatio));
    const height = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.requestRender();
  }

  private get aspect(): number {
    return this.canvas.width / Math.max(1, this.canvas.height);
  }

  /** Accepts a new volume (full rebuild) or picks up edits of the current one (sections whose version changed). */
  setVolume(volume: Volume) {
    if (volume !== this.volume) {
      this.resetVolume(volume);
      return;
    }
    if (this.looks && this.looks.kinds.length !== volume.palette.length) this.looks = buildLookTable(volume.palette);
    const versions = volumeSectionVersions(volume);
    for (let i = 0; i < versions.length; i++) {
      if (versions[i] !== this.knownVersions[i]) {
        this.knownVersions[i] = versions[i];
        this.markDirty(i);
      }
    }
    this.requestRender();
  }

  private resetVolume(volume: Volume) {
    const gl = this.gl;
    if (!this.lost) {
      for (const section of this.sections) {
        if (section.opaque) gl.deleteBuffer(section.opaque);
        if (section.translucent) gl.deleteBuffer(section.translucent);
      }
    }
    this.volume = volume;
    this.looks = buildLookTable(volume.palette);
    this.counts = volumeSectionCounts(volume);
    this.sliceMin = 0;
    this.sliceMax = volume.height - 1;
    const total = this.counts.x * this.counts.y * this.counts.z;
    this.sections = Array.from({ length: total }, () => ({
      opaque: null,
      opaqueQuads: 0,
      translucent: null,
      translucentQuads: 0,
    }));
    this.knownVersions = Uint32Array.from(volumeSectionVersions(volume));
    this.dirty = new Uint8Array(total);
    this.queue = [];
    this.markAllDirty();
    const grid = { ids: volume.ids, sizeX: volume.sizeX, sizeZ: volume.sizeZ, height: volume.height };
    this.content = contentBounds(grid, this.looks);
    this.rebuildGrid();
    this.rebuildHighlights();
    this.rebuildOverlay();

    const key = `${volume.originX},${volume.originZ},${volume.sizeX},${volume.sizeZ},${volume.minY},${volume.height}`;
    if (key !== this.boundsKey) {
      this.boundsKey = key;
      this.resetCamera();
    }
    this.requestRender();
  }

  /** Visible Y range in absolute coordinates (inclusive). */
  setSlice(minY: number, maxY: number) {
    const v = this.volume;
    if (!v) return;
    const min = Math.max(0, Math.min(v.height - 1, minY - v.minY));
    const max = Math.max(-1, Math.min(v.height - 1, maxY - v.minY));
    if (min === this.sliceMin && max === this.sliceMax) return;
    // Sections around the old and new cut planes change: blocks appear/disappear and cap faces move.
    this.markRowsDirty(Math.min(min, this.sliceMin) - 1, Math.max(min, this.sliceMin));
    this.markRowsDirty(Math.min(max, this.sliceMax), Math.max(max, this.sliceMax) + 1);
    this.sliceMin = min;
    this.sliceMax = max;
    this.rebuildGrid();
    this.requestRender();
  }

  private markRowsDirty(fromY: number, toY: number) {
    const lo = Math.max(0, fromY >> 4);
    const hi = Math.min(this.counts.y - 1, toY >> 4);
    const perRow = this.counts.x * this.counts.z;
    for (let sy = lo; sy <= hi; sy++) {
      for (let i = sy * perRow; i < (sy + 1) * perRow; i++) this.markDirty(i);
    }
  }

  private markDirty(i: number) {
    if (this.dirty[i]) return;
    this.dirty[i] = 1;
    this.queue.push(i);
  }

  private markAllDirty() {
    for (let i = 0; i < this.sections.length; i++) this.markDirty(i);
  }

  setHighlights(highlights: readonly BlockPos[]) {
    if (highlights === this.highlights) return;
    this.highlights = highlights;
    this.rebuildHighlights();
    this.requestRender();
  }

  setSelected(pos: BlockPos | null) {
    if (samePos(pos, this.selected)) return;
    this.selected = pos;
    this.rebuildOverlay();
    this.requestRender();
  }

  setHover(pos: BlockPos | null) {
    if (samePos(pos, this.hover)) return;
    this.hover = pos;
    this.rebuildOverlay();
    this.requestRender();
  }

  /** Frames the visible content (clipped to the slice), or the whole volume when it is empty. */
  resetCamera() {
    const v = this.volume;
    if (!v) return;
    this.focusAnimation = null;
    let min: Vec3 = [0, 0, 0];
    let max: Vec3 = [v.sizeX, v.height, v.sizeZ];
    if (this.content) {
      min = [...this.content.min];
      max = [...this.content.max];
    }
    if (this.sliceMax >= this.sliceMin) {
      min[1] = Math.min(Math.max(min[1], this.sliceMin), this.sliceMax);
      max[1] = Math.max(Math.min(max[1], this.sliceMax + 1), min[1] + 1);
    }
    Object.assign(this.camera, fitCamera(min, max, this.aspect));
    this.requestRender();
  }

  /** Smoothly moves the camera target to the block (absolute coordinates), closing in when far away. */
  focus(pos: BlockPos) {
    const v = this.volume;
    if (!v) return;
    this.focusAnimation = {
      from: [...this.camera.target],
      to: [pos.x - v.originX + 0.5, pos.y - v.minY + 0.5, pos.z - v.originZ + 0.5],
      fromDistance: this.camera.distance,
      toDistance: Math.min(this.camera.distance, FOCUS_MAX_DISTANCE),
      start: performance.now(),
    };
    this.requestRender();
  }

  cancelFocusAnimation() {
    this.focusAnimation = null;
  }

  /** The first visible block under a viewport point given in CSS pixels relative to the canvas. */
  pick(cssX: number, cssY: number, cssWidth: number, cssHeight: number): BlockHit | null {
    const v = this.volume;
    if (!v || !this.looks || cssWidth <= 0 || cssHeight <= 0) return null;
    const ndcX = (cssX / cssWidth) * 2 - 1;
    const ndcY = 1 - (cssY / cssHeight) * 2;
    const ray = cameraRay(this.camera, cssWidth / cssHeight, ndcX, ndcY);
    const origin: Vec3 = [ray.origin[0] + v.originX, ray.origin[1] + v.minY, ray.origin[2] + v.originZ];
    return pickBlock(v, this.looks.kinds, origin, ray.dir, this.sliceMin + v.minY, this.sliceMax + v.minY);
  }

  requestRender() {
    if (this.frame || this.disposed || this.lost) return;
    this.frame = requestAnimationFrame(this.renderFrame);
  }

  private renderFrame = (time: number) => {
    this.frame = 0;
    if (this.disposed || this.lost || !this.res) return;
    const dt = this.lastFrameTime ? Math.min(0.1, (time - this.lastFrameTime) / 1000) : 0;
    let animating = this.hooks.beforeFrame(dt);
    this.lastFrameTime = animating ? time : 0;

    if (this.focusAnimation) {
      const a = this.focusAnimation;
      const t = Math.min(1, (performance.now() - a.start) / FOCUS_DURATION_MS);
      const ease = 1 - (1 - t) ** 3;
      for (let i = 0; i < 3; i++) this.camera.target[i] = a.from[i] + (a.to[i] - a.from[i]) * ease;
      this.camera.distance = a.fromDistance + (a.toDistance - a.fromDistance) * ease;
      if (t >= 1) this.focusAnimation = null;
      else animating = true;
    }
    clampCamera(this.camera);

    this.processQueue();
    this.draw();
    if (animating || this.queue.length > 0) this.requestRender();
  };

  private processQueue() {
    const v = this.volume;
    const looks = this.looks;
    if (!v || !looks || this.queue.length === 0) return;
    const { x: nx, z: nz } = this.counts;
    const target = this.camera.target;
    const distance = (i: number) => {
      const sx = i % nx;
      const sz = Math.floor(i / nx) % nz;
      const sy = Math.floor(i / (nx * nz));
      return (sx * 16 + 8 - target[0]) ** 2 + (sy * 16 + 8 - target[1]) ** 2 + (sz * 16 + 8 - target[2]) ** 2;
    };
    // nearest first; the queue is popped from the end
    this.queue.sort((a, b) => distance(b) - distance(a));
    const grid = { ids: v.ids, sizeX: v.sizeX, sizeZ: v.sizeZ, height: v.height };
    const origin: Vec3 = [v.originX, v.minY, v.originZ];
    const start = performance.now();
    while (this.queue.length > 0 && performance.now() - start < MESH_BUDGET_MS) {
      const i = this.queue.pop() as number;
      this.dirty[i] = 0;
      const sx = i % nx;
      const sz = Math.floor(i / nx) % nz;
      const sy = Math.floor(i / (nx * nz));
      const mesh = meshSection(grid, looks, this.sliceMin, this.sliceMax, sx, sy, sz, origin);
      const section = this.sections[i];
      section.opaque = this.upload(section.opaque, mesh.opaque);
      section.opaqueQuads = mesh.opaque.length / (VERTEX_STRIDE * 4);
      section.translucent = this.upload(section.translucent, mesh.translucent);
      section.translucentQuads = mesh.translucent.length / (VERTEX_STRIDE * 4);
      this.ensureIndices(Math.max(section.opaqueQuads, section.translucentQuads));
    }
  }

  private upload(buffer: WebGLBuffer | null, data: Uint8Array): WebGLBuffer | null {
    const gl = this.gl;
    if (data.length === 0) {
      if (buffer) gl.deleteBuffer(buffer);
      return null;
    }
    const target = buffer ?? gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, target);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return target;
  }

  private ensureIndices(quads: number) {
    const res = this.res;
    if (!res || quads <= res.indexCapacity) return;
    let capacity = Math.max(1024, res.indexCapacity);
    while (capacity < quads) capacity *= 2;
    const indices = new Uint32Array(capacity * 6);
    for (let q = 0, v = 0, i = 0; q < capacity; q++, v += 4, i += 6) {
      indices[i] = v;
      indices[i + 1] = v + 1;
      indices[i + 2] = v + 2;
      indices[i + 3] = v;
      indices[i + 4] = v + 2;
      indices[i + 5] = v + 3;
    }
    const gl = this.gl;
    gl.bindVertexArray(res.meshVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    res.indexCapacity = capacity;
  }

  private rebuildGrid() {
    const res = this.res;
    const v = this.volume;
    if (!res || !v) return;
    const points: number[] = [];
    // outlines span the visible content only, not the empty sky up to the build limit
    const top = Math.min(this.sliceMax, this.content ? this.content.max[1] - 1 : this.sliceMax);
    const bottom = Math.max(this.sliceMin, this.content ? this.content.min[1] : this.sliceMin);
    if (top >= bottom) {
      for (const model of v.chunks) {
        const x = model.x * 16 - v.originX;
        const z = model.z * 16 - v.originZ;
        pushBox(points, x, bottom, z, x + 16, top + 1, z + 16);
      }
    }
    this.gridVertices = points.length / 3;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
  }

  private rebuildHighlights() {
    const res = this.res;
    const v = this.volume;
    if (!res || !v) return;
    const count = Math.min(this.highlights.length, MAX_HIGHLIGHT_BOXES);
    const points: number[] = [];
    const pad = 0.02;
    for (let i = 0; i < count; i++) {
      const p = this.highlights[i];
      const x = p.x - v.originX;
      const y = p.y - v.minY;
      const z = p.z - v.originZ;
      pushBox(points, x - pad, y - pad, z - pad, x + 1 + pad, y + 1 + pad, z + 1 + pad);
    }
    this.highlightVertices = points.length / 3;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.highlightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
  }

  private rebuildOverlay() {
    const res = this.res;
    const v = this.volume;
    if (!res || !v) return;
    const points: number[] = [];
    const box = (p: BlockPos, pad: number) => {
      const x = p.x - v.originX;
      const y = p.y - v.minY;
      const z = p.z - v.originZ;
      pushBox(points, x - pad, y - pad, z - pad, x + 1 + pad, y + 1 + pad, z + 1 + pad);
    };
    if (this.selected) box(this.selected, 0.03);
    this.overlaySelectedVertices = points.length / 3;
    if (this.hover && !samePos(this.hover, this.selected)) box(this.hover, 0.01);
    this.overlayHoverVertices = points.length / 3 - this.overlaySelectedVertices;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, res.overlayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
  }

  private bindMeshBuffer(buffer: WebGLBuffer) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_STRIDE, 0);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, false, VERTEX_STRIDE, 12);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, VERTEX_STRIDE, 16);
    gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, VERTEX_STRIDE, 20);
  }

  private draw() {
    const gl = this.gl;
    const res = this.res;
    if (!res) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.volume) this.drawScene(res);
  }

  private drawScene(res: GlResources) {
    const gl = this.gl;
    viewProjection(this.camera, this.aspect, this.viewProj);
    const eye = cameraEye(this.camera);
    const { x: nx, z: nz } = this.counts;
    const eyeDistance = (i: number) => {
      const sx = i % nx;
      const sz = Math.floor(i / nx) % nz;
      const sy = Math.floor(i / (nx * nz));
      return (sx * 16 + 8 - eye[0]) ** 2 + (sy * 16 + 8 - eye[1]) ** 2 + (sz * 16 + 8 - eye[2]) ** 2;
    };

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.useProgram(res.meshProgram);
    gl.uniformMatrix4fv(res.meshViewProj, false, this.viewProj);
    gl.bindVertexArray(res.meshVao);

    const translucent: number[] = [];
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i];
      if (section.translucent) translucent.push(i);
      if (!section.opaque) continue;
      this.bindMeshBuffer(section.opaque);
      gl.drawElements(gl.TRIANGLES, section.opaqueQuads * 6, gl.UNSIGNED_INT, 0);
    }

    if (translucent.length > 0) {
      translucent.sort((a, b) => eyeDistance(b) - eyeDistance(a));
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const i of translucent) {
        const section = this.sections[i];
        if (!section.translucent) continue;
        this.bindMeshBuffer(section.translucent);
        gl.drawElements(gl.TRIANGLES, section.translucentQuads * 6, gl.UNSIGNED_INT, 0);
      }
    }
    gl.bindVertexArray(null);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(res.lineProgram);
    gl.uniformMatrix4fv(res.lineViewProj, false, this.viewProj);
    gl.bindVertexArray(res.lineVao);

    const lines = (buffer: WebGLBuffer, first: number, count: number, rgba: readonly number[], depth: boolean) => {
      if (count <= 0) return;
      if (depth) gl.enable(gl.DEPTH_TEST);
      else gl.disable(gl.DEPTH_TEST);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
      gl.uniform4f(res.lineColor, rgba[0], rgba[1], rgba[2], rgba[3]);
      gl.drawArrays(gl.LINES, first, count);
    };
    lines(res.gridBuffer, 0, this.gridVertices, [1, 1, 1, 0.1], true);
    // Highlights and the selection show through terrain dimly and at full strength where visible.
    lines(res.highlightBuffer, 0, this.highlightVertices, [0.99, 0.77, 0.1, 0.35], false);
    lines(res.highlightBuffer, 0, this.highlightVertices, [0.99, 0.77, 0.1, 1], true);
    lines(res.overlayBuffer, 0, this.overlaySelectedVertices, [0.3, 0.67, 0.97, 0.45], false);
    lines(res.overlayBuffer, 0, this.overlaySelectedVertices, [0.3, 0.67, 0.97, 1], true);
    lines(res.overlayBuffer, this.overlaySelectedVertices, this.overlayHoverVertices, [1, 1, 1, 0.55], false);

    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  }
}

export function samePos(a: BlockPos | null, b: BlockPos | null): boolean {
  if (a === b) return true;
  return !!a && !!b && a.x === b.x && a.y === b.y && a.z === b.z;
}
