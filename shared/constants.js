// Shared by the browser and the Node game server. All distances are metres, angles radians, time seconds.
export const TILE = 2;                 // a map grid cell is 2 m square
export const TICK = 1 / 60;            // fixed simulation step
export const HEIGHTS = { '#': 3.2, C: 2.3, c: 1.05 };   // wall, tall cover, low cover (you can shoot over low cover)
export const SPAWN_ZONE = 5;           // columns at each end of the map where teams spawn

export const BODY = {
  radius: 0.35,        // collision
  eyeStand: 1.62,
  eyeCrouch: 1.12,
  headR: 0.17,
  bodyR: 0.32,
};

export const MOVE = {
  walk: 5.2,
  sprint: 1.45,        // multipliers
  ads: 0.55,
  crouch: 0.55,
  accel: 14,
  airControl: 0.3,
  jump: 4.2,
  gravity: 14,
  crouchRate: 7,       // crouch transitions per second
};

export const FRAG = { radius: 6, damage: 150, fuse: 2, speed: 15, lift: 2.5 };
export const AIRSTRIKE = { radius: 7, damage: 200 };
export const KNIFE = { range: 2, damage: 135, cooldown: 0.8, swing: 0.22 };
export const REGEN = { delay: 4.5, rate: 35 };
export const RESPAWN = { human: 4, bot: 5 };
