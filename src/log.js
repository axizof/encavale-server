// Journal de la console, horodaté et en couleur
const tty = process.stdout.isTTY;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ts = () => new Date().toTimeString().slice(0, 8);

let hook = null; // la console interactive réaffiche son invite après chaque ligne

export const log = {
  setHook(fn) { hook = fn; },
  out(line) {
    if (hook) hook(line); else console.log(line);
  },
  info(msg) { log.out(`${c(90, ts())} ${msg}`); },
  ok(msg) { log.out(`${c(90, ts())} ${c(32, msg)}`); },
  warn(msg) { log.out(`${c(90, ts())} ${c(33, msg)}`); },
  error(msg) { log.out(`${c(90, ts())} ${c(31, msg)}`); },
  chat(name, msg) { log.out(`${c(90, ts())} ${c(36, `<${name}>`)} ${msg}`); },
  bold: (s) => c(1, s),
  dim: (s) => c(90, s),
  cyan: (s) => c(36, s),
  yellow: (s) => c(33, s),
};
