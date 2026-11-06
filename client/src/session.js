import { Match } from '@shared/match.js';

/** Offline practice: the whole match runs in the browser with the shared rules. */
export class LocalSession {
  constructor(data, cfg) {
    this.online = false;
    this.M = new Match(data, { map: cfg.map, limit: cfg.limit, difficulty: cfg.diff });
    this.me = this.M.addHuman(cfg.name, 'blue', cfg.primary, null, cfg.optics?.[cfg.primary]);
    this.M.balanceBots(data.match.teamSize);
    this.M.emit('start', {});
  }

  // One fixed simulation step with the local player's command.
  step(cmd) {
    this.M.applyCommand(this.me, cmd);
    this.M.tick();
  }

  update() {}

  drain(fn) {
    const events = this.M.events;
    this.M.events = [];
    for (const e of events) fn(e);
  }

  leave() {}
}
