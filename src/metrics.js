// Mesures du serveur, une par seconde : processeur, mémoire, latence de la boucle, temps de calcul,
// réseau, joueurs et voitures simulées. Historique : 1 h à la seconde, 24 h à la minute.
const KEYS = ['cpu', 'rss', 'heap', 'lag', 'lagMax', 'tick', 'sim', 'out', 'in', 'players', 'traffic', 'police'];

export class Metrics {
  constructor(srv) {
    this.srv = srv;
    this.sec = []; // 3600 dernières secondes
    this.min = []; // 1440 dernières minutes
    this.acc = [];
    // latence de la boucle : un minuteur de 100 ms mesure son propre retard (marche sous Node et Bun)
    this.lagSum = 0; this.lagN = 0; this.lagPeak = 0;
    let next = performance.now() + 100;
    this.lagTimer = setInterval(() => {
      const now = performance.now(), late = Math.max(0, now - next);
      next = now + 100;
      this.lagSum += late; this.lagN++; this.lagPeak = Math.max(this.lagPeak, late);
    }, 100);
    this.lagTimer.unref?.();
    this.cpu = process.cpuUsage();
    this.t = process.hrtime.bigint();
    this.started = Date.now();
    this.timer = setInterval(() => this.sample(), 1000);
    this.timer.unref?.();
  }

  sample() {
    const now = process.hrtime.bigint();
    const us = Number(now - this.t) / 1000;
    const c = process.cpuUsage(this.cpu);
    this.cpu = process.cpuUsage();
    this.t = now;
    const mem = process.memoryUsage();
    const srv = this.srv;
    const ss = srv.sim ? srv.sim.stats() : { traffic: 0, police: 0 };
    let police = ss.police;
    for (const p of srv.players.values()) if (p.inRound && p.alive && p.bots) police += p.bots.length; // polices « réactives » des joueurs
    const s = {
      t: Date.now(),
      cpu: Math.round(((c.user + c.system) / us) * 1000) / 10, // % d'un cœur
      rss: Math.round(mem.rss / 1048576),
      heap: Math.round(mem.heapUsed / 1048576),
      lag: Math.round((this.lagN ? this.lagSum / this.lagN : 0) * 10) / 10,
      lagMax: Math.round(this.lagPeak * 10) / 10,
      tick: Math.round((srv.tickMs || 0) * 100) / 100,
      sim: Math.round((srv.simMs || 0) * 100) / 100,
      out: Math.round(srv.bytesOut / 1024),
      in: Math.round(srv.bytesIn / 1024),
      players: srv.players.size,
      traffic: ss.traffic,
      police,
    };
    this.lagSum = 0; this.lagN = 0; this.lagPeak = 0;
    srv.bytesOut = 0;
    srv.bytesIn = 0;
    this.sec.push(s);
    if (this.sec.length > 3600) this.sec.shift();
    this.acc.push(s);
    if (this.acc.length >= 60) {
      const m = { t: s.t };
      for (const k of KEYS) m[k] = Math.round((this.acc.reduce((a, x) => a + x[k], 0) / this.acc.length) * 10) / 10;
      m.cpuMax = Math.max(...this.acc.map((x) => x.cpu));
      this.min.push(m);
      if (this.min.length > 1440) this.min.shift();
      this.acc = [];
    }
  }

  last() { return this.sec[this.sec.length - 1] || null; }

  /** range : '5m' (secondes), '1h' (secondes), '24h' (minutes) */
  history(range) {
    if (range === '24h') return this.min;
    if (range === '1h') return this.sec;
    return this.sec.slice(-300);
  }

  /** moyenne des n dernières secondes */
  avg(n = 60) {
    const xs = this.sec.slice(-n);
    if (!xs.length) return null;
    const o = {};
    for (const k of KEYS) o[k] = Math.round((xs.reduce((a, x) => a + x[k], 0) / xs.length) * 10) / 10;
    return o;
  }

  uptime() { return Math.floor((Date.now() - this.started) / 1000); }
}
