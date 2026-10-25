import type { Waveform, WaveSignal } from "./types";

export function parseVcd(source: string): Waveform {
  const lines = source.split(/\r?\n/);
  const scopes: string[] = [];
  const ids = new Map<string, WaveSignal>();
  const timescaleMatch = /\$timescale\s+([\s\S]*?)\s+\$end/.exec(source);
  const timescale = timescaleMatch?.[1].replace(/\s+/g, "") || "1ns";
  let endTime = 0;
  let time = 0;
  let inHeader = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (inHeader) {
      if (parts[0] === "$scope" && parts.length >= 3) {
        scopes.push(parts[2]);
      } else if (parts[0] === "$upscope") {
        scopes.pop();
      } else if (parts[0] === "$var" && parts.length >= 5) {
        const width = Number(parts[2]) || 1;
        const id = parts[3];
        const name = [...scopes, parts.slice(4).find((part) => !part.startsWith("$")) ?? "signal"].join(".");
        const prior = ids.get(id);
        if (prior) {
          prior.name = `${prior.name}, ${name}`;
        } else {
          ids.set(id, { id, name, width, changes: [] });
        }
      } else if (parts[0] === "$enddefinitions") {
        inHeader = false;
      }
      continue;
    }

    if (trimmed.startsWith("#")) {
      const parsed = Number(trimmed.slice(1));
      if (Number.isFinite(parsed)) {
        time = parsed;
        endTime = Math.max(endTime, time);
      }
      continue;
    }
    if (trimmed.startsWith("$")) continue;

    let value: string;
    let id: string;
    if (/^[01xXzZ]/.test(trimmed)) {
      value = trimmed[0].toLowerCase();
      id = trimmed.slice(1).trim();
    } else if (/^[bB]/.test(trimmed)) {
      const match = /^b([01xXzZ]+)\s+(\S+)/.exec(trimmed);
      if (!match) continue;
      value = match[1].toLowerCase();
      id = match[2];
    } else if (/^[rR]/.test(trimmed)) {
      continue;
    } else {
      continue;
    }
    const signal = ids.get(id);
    if (!signal) continue;
    const normalized = signal.width > 1 ? value.padStart(signal.width, value[0] === "x" || value[0] === "z" ? value[0] : "0") : value.at(-1) ?? value;
    const previous = signal.changes.at(-1);
    if (!previous || previous.value !== normalized || previous.time !== time) signal.changes.push({ time, value: normalized });
  }

  return { timescale, endTime, signals: [...ids.values()] };
}
