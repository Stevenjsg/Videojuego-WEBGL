/**
 * Corta las pistas de música en fragmentos para el MusicDirector.
 *
 * Uso:  pnpm cut-music          (requiere ffmpeg en el PATH)
 *
 * Por pista:
 * - Recorta silencios de inicio/fin.
 * - Corta cada 24–40 s en el punto más silencioso de esa ventana, con fundido
 *   de entrada y salida, para que cada fragmento suene completo por sí solo.
 * - Etiqueta cada fragmento con su intensidad (0..1, por volumen medio
 *   relativo a la pista).
 *
 * Salida: public/music/<zona>/<nombre>-NN.mp3 y public/music/manifest.json
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const TRACKS = [
  // El hall de la mansión.
  { zone: "zona1", name: "horrorland", src: "assets-src/music/zona1_welcome-to-horrorland.mp3" },
  // La casa (apartamento).
  { zone: "zona2", name: "house-of-leaves", src: "assets-src/music/zona2_the-house-of-leaves.mp3" },
];

const OUT = "public/music";
const MIN_LEN = 24;
const MAX_LEN = 40;
const FADE_IN = 2;
const FADE_OUT = 3;
/** Ventana de análisis de volumen (s). */
const WIN = 0.5;
/** Por debajo de esto (dBFS) se considera silencio de inicio/fin. */
const SILENCE_DB = -45;

const manifest = {};

for (const track of TRACKS) {
  const rms = loudness(track.src);
  const first = rms.findIndex((db) => db > SILENCE_DB);
  const last = rms.length - 1 - [...rms].reverse().findIndex((db) => db > SILENCE_DB);
  const start = first * WIN;
  const end = (last + 1) * WIN;

  // Puntos de corte en el mínimo de volumen de cada ventana [24, 40] s.
  const cuts = [start];
  let t = start;
  while (end - t > MAX_LEN) {
    let best = t + MIN_LEN;
    let bestDb = Infinity;
    for (let s = t + MIN_LEN; s <= t + MAX_LEN; s += WIN) {
      const db = rms[Math.floor(s / WIN)] ?? -Infinity;
      if (db < bestDb) {
        bestDb = db;
        best = s;
      }
    }
    // Un último trozo muy corto se une al anterior.
    if (end - best < MIN_LEN / 2) break;
    cuts.push(best);
    t = best;
  }
  cuts.push(end);

  const dir = path.join(OUT, track.zone);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const segments = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    const len = b - a;
    const file = `${track.name}-${String(i + 1).padStart(2, "0")}.mp3`;
    ffmpeg([
      "-ss", a.toFixed(2), "-t", len.toFixed(2), "-i", track.src,
      "-af", `afade=t=in:d=${FADE_IN},afade=t=out:st=${(len - FADE_OUT).toFixed(2)}:d=${FADE_OUT}`,
      "-b:a", "128k", path.join(dir, file),
    ]);

    // Volumen medio (en potencia) del fragmento.
    const slice = rms.slice(Math.floor(a / WIN), Math.floor(b / WIN));
    const meanPow = slice.reduce((s, db) => s + 10 ** (db / 10), 0) / slice.length;
    segments.push({
      url: `${track.zone}/${file}`,
      duration: +len.toFixed(2),
      db: 10 * Math.log10(meanPow),
    });
  }

  // Intensidad relativa dentro de la pista.
  const dbs = segments.map((s) => s.db);
  const lo = Math.min(...dbs);
  const hi = Math.max(...dbs);
  manifest[track.zone] = segments.map(({ url, duration, db }) => ({
    url,
    duration,
    intensity: +(hi > lo ? (db - lo) / (hi - lo) : 0.5).toFixed(2),
  }));

  const kb = segments.reduce((n, s) => n + statSync(path.join(OUT, s.url)).size, 0) / 1024;
  console.log(
    `✔ ${track.zone}/${track.name}: ${segments.length} fragmentos ` +
      `(${segments.map((s) => s.duration.toFixed(0) + "s").join(", ")}) ${kb.toFixed(0)} KB`,
  );
}

writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

/** RMS (dBFS) por ventanas de WIN segundos. */
function loudness(src) {
  const r = ffmpeg(
    [
      "-i", src,
      "-af", `aresample=44100,asetnsamples=n=${Math.round(44100 * WIN)},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level`,
      "-f", "null", "-",
    ],
    true,
  );
  return [...r.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) =>
    m[1] === "-inf" ? -120 : Number(m[1]),
  );
}

function ffmpeg(args, capture = false) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-y", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`ffmpeg falló:\n${r.stderr}`);
  return capture ? r.stderr : "";
}
