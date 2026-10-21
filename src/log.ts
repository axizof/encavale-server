// Journal de la console, horodaté et en couleur
const tty = process.stdout.isTTY;
const c = (code: number, s: string): string => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ts = (): string => new Date().toTimeString().slice(0, 8);

let hook: ((line: string) => void) | null = null; // la console interactive réaffiche son invite après chaque ligne
const recent: string[] = []; // dernières lignes (panneau admin)

export const log = {
  setHook(fn: (line: string) => void): void { hook = fn; },
  out(line: string): void {
    recent.push(line.replace(/\x1b\[[0-9;]*m/g, ''));
    if (recent.length > 300) recent.shift();
    if (hook) hook(line); else console.log(line);
  },
  recent(): string[] { return recent.slice(); },
  // ligne affichée dans le terminal mais pas gardée pour le panneau (bannière avec les codes secrets)
  plain(line: string): void { if (hook) hook(line); else console.log(line); },
  info(msg: string): void { log.out(`${c(90, ts())} ${msg}`); },
  ok(msg: string): void { log.out(`${c(90, ts())} ${c(32, msg)}`); },
  warn(msg: string): void { log.out(`${c(90, ts())} ${c(33, msg)}`); },
  error(msg: string): void { log.out(`${c(90, ts())} ${c(31, msg)}`); },
  chat(name: string, msg: string): void { log.out(`${c(90, ts())} ${c(36, `<${name}>`)} ${msg}`); },
  bold: (s: string): string => c(1, s),
  dim: (s: string): string => c(90, s),
  cyan: (s: string): string => c(36, s),
  yellow: (s: string): string => c(33, s),
};
