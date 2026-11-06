import { BODY, MOVE } from './constants.js';
import { clamp, lerp } from './util.js';

export const eyeHeight = s => s.y + lerp(BODY.eyeStand, BODY.eyeCrouch, s.crouchT);

/**
 * One fixed step of player movement. Pure function of (world, state, command), so the server and the
 * client's prediction produce identical results. `cmd`: f/s in -1..1 (forward/strafe), yaw, sprint, ads,
 * crouch, jump. `weaponMove` scales speed (heavy guns are slower).
 */
export function stepMovement(world, s, cmd, dt, weaponMove = 1) {
  s.crouchT += clamp((cmd.crouch ? 1 : 0) - s.crouchT, -MOVE.crouchRate * dt, MOVE.crouchRate * dt);
  const sy = Math.sin(cmd.yaw), cy = Math.cos(cmd.yaw);
  let mx = -sy * cmd.f + cy * cmd.s, mz = -cy * cmd.f - sy * cmd.s;
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  s.sprinting = !!cmd.sprint && cmd.f > 0.1 && !cmd.ads && s.crouchT < 0.5;
  const speed = MOVE.walk * weaponMove * (s.sprinting ? MOVE.sprint : 1) * (cmd.ads ? MOVE.ads : 1) * (1 - (1 - MOVE.crouch) * s.crouchT);
  const k = Math.min(1, MOVE.accel * dt * (s.onGround ? 1 : MOVE.airControl));
  s.vx += (mx * speed - s.vx) * k;
  s.vz += (mz * speed - s.vz) * k;
  world.move(s, s.vx * dt, s.vz * dt, BODY.radius);
  if (cmd.jump && s.onGround && s.crouchT < 0.5) { s.vy = MOVE.jump; s.onGround = false; }
  if (!s.onGround) {
    s.vy -= MOVE.gravity * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) { s.y = 0; s.vy = 0; s.onGround = true; }
  }
  s.moving = len > 0.05;
}
