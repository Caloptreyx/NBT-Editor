export type Vec3 = [number, number, number];

/** Orbit camera around `target`; yaw 0 looks toward -Z, positive pitch looks down from above. */
export interface OrbitCamera {
  target: Vec3;
  yaw: number;
  pitch: number;
  distance: number;
}

export const FOV_Y = (55 * Math.PI) / 180;
export const MIN_DISTANCE = 2;
export const MAX_DISTANCE = 2000;
const MAX_PITCH = Math.PI / 2 - 0.01;

export function clampCamera(c: OrbitCamera): OrbitCamera {
  c.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, c.pitch));
  c.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, c.distance));
  c.yaw = ((c.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return c;
}

export function cameraEye(c: OrbitCamera): Vec3 {
  const cp = Math.cos(c.pitch);
  return [
    c.target[0] + c.distance * cp * Math.sin(c.yaw),
    c.target[1] + c.distance * Math.sin(c.pitch),
    c.target[2] + c.distance * cp * Math.cos(c.yaw),
  ];
}

/** Unit forward/right/up vectors of the camera. */
export function cameraBasis(c: OrbitCamera): { forward: Vec3; right: Vec3; up: Vec3 } {
  const cp = Math.cos(c.pitch);
  const forward: Vec3 = [-cp * Math.sin(c.yaw), -Math.sin(c.pitch), -cp * Math.cos(c.yaw)];
  const right: Vec3 = [Math.cos(c.yaw), 0, -Math.sin(c.yaw)];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { forward, right, up };
}

export function clipPlanes(c: OrbitCamera): { near: number; far: number } {
  return { near: Math.max(0.05, Math.min(1, c.distance / 400)), far: c.distance + 2500 };
}

/** Column-major projection * view matrix. */
export function viewProjection(c: OrbitCamera, aspect: number, out = new Float32Array(16)): Float32Array {
  const eye = cameraEye(c);
  const { forward, right, up } = cameraBasis(c);
  const { near, far } = clipPlanes(c);
  const f = 1 / Math.tan(FOV_Y / 2);
  const px = f / aspect;
  const py = f;
  const pz = (far + near) / (near - far);
  const pw = (2 * far * near) / (near - far);
  const back: Vec3 = [-forward[0], -forward[1], -forward[2]];
  const tx = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
  const ty = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
  const tz = -(back[0] * eye[0] + back[1] * eye[1] + back[2] * eye[2]);
  // view rows: right, up, back; projection applied per row.
  for (let col = 0; col < 3; col++) {
    out[col * 4] = px * right[col];
    out[col * 4 + 1] = py * up[col];
    out[col * 4 + 2] = pz * back[col];
    out[col * 4 + 3] = -back[col];
  }
  out[12] = px * tx;
  out[13] = py * ty;
  out[14] = pz * tz + pw;
  out[15] = -tz;
  return out;
}

/** World-space ray through normalized device coordinates (-1..1, y up). */
export function cameraRay(c: OrbitCamera, aspect: number, ndcX: number, ndcY: number): { origin: Vec3; dir: Vec3 } {
  const { forward, right, up } = cameraBasis(c);
  const t = Math.tan(FOV_Y / 2);
  const sx = ndcX * t * aspect;
  const sy = ndcY * t;
  const dir: Vec3 = [
    forward[0] + right[0] * sx + up[0] * sy,
    forward[1] + right[1] * sx + up[1] * sy,
    forward[2] + right[2] * sx + up[2] * sy,
  ];
  const length = Math.hypot(dir[0], dir[1], dir[2]);
  return { origin: cameraEye(c), dir: [dir[0] / length, dir[1] / length, dir[2] / length] };
}

/** Camera looking diagonally down at the box so that its bounding sphere fits the viewport. */
export function fitCamera(min: Vec3, max: Vec3, aspect: number): OrbitCamera {
  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(1, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2);
  const halfFovX = Math.atan(Math.tan(FOV_Y / 2) * Math.max(aspect, 0.1));
  const halfFov = Math.min(FOV_Y / 2, halfFovX);
  return clampCamera({ target, yaw: Math.PI / 4, pitch: 0.6, distance: radius / Math.sin(halfFov) });
}

/** Moves the target in the view plane by a screen-space offset in pixels. */
export function panCamera(c: OrbitCamera, dxPixels: number, dyPixels: number, viewportHeight: number) {
  const { right, up } = cameraBasis(c);
  const worldPerPixel = (2 * c.distance * Math.tan(FOV_Y / 2)) / Math.max(1, viewportHeight);
  for (let i = 0; i < 3; i++) c.target[i] += (-right[i] * dxPixels + up[i] * dyPixels) * worldPerPixel;
}

/** Moves the target horizontally relative to the camera heading (forward/strafe in blocks). */
export function walkCamera(c: OrbitCamera, forwardAmount: number, rightAmount: number) {
  const sin = Math.sin(c.yaw);
  const cos = Math.cos(c.yaw);
  c.target[0] += -sin * forwardAmount + cos * rightAmount;
  c.target[2] += -cos * forwardAmount - sin * rightAmount;
}
