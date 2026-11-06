export const TAU = Math.PI * 2;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = n => Math.floor(Math.random() * n);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function angDiff(a, b) {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randi(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// View convention (same as a Three.js camera with rotation order 'YXZ'): yaw 0 looks down -Z, positive pitch looks up.
export function forward(yaw, pitch, out = {}) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
