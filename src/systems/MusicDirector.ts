import * as THREE from "three";

/**
 * Director de música: reproduce fragmentos sueltos (scripts/cut-music.mjs)
 * de la pista de la zona actual, al azar y según la tensión del momento.
 *
 * - Calma: silencios largos y fragmentos de baja intensidad.
 * - Tensión: silencios cortos y fragmentos intensos.
 * - Pico de tensión (empieza una persecución): corta lo que suene y entra
 *   un fragmento intenso enseguida.
 * - Cada zona solo suena dentro de ella: al cambiar de zona se funde.
 */

type Segment = { url: string; duration: number; intensity: number };
type Manifest = Record<string, Segment[]>;

export type MusicDirectorConfig = {
  manifestUrl: string;
  volume?: number;
};

/** Silencio entre fragmentos (s): [mínimo, máximo] en calma y con tensión. */
const GAP_CALM: [number, number] = [20, 45];
const GAP_TENSE: [number, number] = [3, 8];
/** Silencio tras entrar en una zona nueva. */
const GAP_ZONE_CHANGE: [number, number] = [4, 10];
const FADE_IN = 1.5;
const FADE_OUT = 1.5;
/** Pico de tensión: de menos de LOW a más de HIGH. */
const SPIKE_LOW = 0.4;
const SPIKE_HIGH = 0.7;
/** No repetir los últimos N fragmentos. */
const HISTORY = 2;

export class MusicDirector {
  private manifest: Manifest | null = null;
  private baseUrl: string;
  private volume: number;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private loader = new THREE.AudioLoader();

  private zone: string | null = null;
  private current: { audio: THREE.Audio; segment: Segment } | null = null;
  private recent: string[] = [];
  private wait = randomIn(GAP_ZONE_CHANGE);
  private calmTension = true;
  private starting = false;

  constructor(
    private listener: THREE.AudioListener,
    cfg: MusicDirectorConfig,
  ) {
    this.baseUrl = cfg.manifestUrl.slice(0, cfg.manifestUrl.lastIndexOf("/") + 1);
    this.volume = cfg.volume ?? 0.3;
    fetch(cfg.manifestUrl)
      .then((r) => r.json())
      .then((m: Manifest) => (this.manifest = m))
      .catch((err) => console.warn("[MusicDirector] Sin manifest:", err));
  }

  /** Zona actual (clave del manifest) o null para silencio. */
  setZone(zone: string | null) {
    if (zone === this.zone) return;
    this.zone = zone;
    this.stopCurrent(FADE_OUT);
    this.wait = randomIn(GAP_ZONE_CHANGE);
    this.recent.length = 0;
  }

  /** `tension` 0..1 (p. ej. el miedo del jugador). */
  update(dt: number, tension: number) {
    if (!this.manifest || this.listener.context.state !== "running") return;

    // Pico: corta un fragmento tranquilo y entra uno intenso ya.
    const spike = this.calmTension && tension > SPIKE_HIGH;
    if (tension > SPIKE_HIGH) this.calmTension = false;
    else if (tension < SPIKE_LOW) this.calmTension = true;
    if (spike && (!this.current || this.current.segment.intensity < 0.5)) {
      this.stopCurrent(0.8);
      this.wait = 0;
    }

    if (this.current || this.starting) return;

    // Con tensión el silencio se consume más deprisa.
    this.wait -= dt * (1 + 2 * tension);
    if (this.wait <= 0) this.playNext(tension);
  }

  stop() {
    this.zone = null;
    this.stopCurrent(FADE_OUT);
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private async playNext(tension: number) {
    const segment = this.pick(tension);
    if (!segment) {
      this.wait = randomIn(GAP_CALM);
      return;
    }

    this.starting = true;
    const zone = this.zone;
    const buffer = await this.getBuffer(segment.url);
    this.starting = false;
    // La zona pudo cambiar mientras se descargaba.
    if (!buffer || zone !== this.zone || this.current) return;

    const audio = new THREE.Audio(this.listener);
    audio.setBuffer(buffer);
    audio.setLoop(false);
    const gain = audio.gain.gain;
    const now = this.listener.context.currentTime;
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(this.volume, now + FADE_IN);
    audio.play();

    this.current = { audio, segment };
    this.recent.push(segment.url);
    if (this.recent.length > HISTORY) this.recent.shift();

    audio.onEnded = () => {
      audio.isPlaying = false;
      if (this.current?.audio !== audio) return;
      this.current = null;
      this.wait = lerpRange(GAP_CALM, GAP_TENSE, tension);
    };

    // Precargar uno probable para el siguiente.
    const next = this.pick(tension);
    if (next) this.getBuffer(next.url);
  }

  /** Al azar, con más peso cuanto más se parece su intensidad a la tensión. */
  private pick(tension: number): Segment | null {
    const all = (this.zone && this.manifest?.[this.zone]) || [];
    const pool = all.filter((s) => !this.recent.includes(s.url));
    const candidates = pool.length > 0 ? pool : all;
    if (candidates.length === 0) return null;

    const weights = candidates.map(
      (s) => 1 / (0.15 + Math.abs(s.intensity - tension)),
    );
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < candidates.length; i++) {
      r -= weights[i];
      if (r <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  private stopCurrent(fade: number) {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    const gain = cur.audio.gain.gain;
    const now = this.listener.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => {
      if (cur.audio.isPlaying) cur.audio.stop();
    }, fade * 1000 + 50);
  }

  private getBuffer(url: string) {
    let p = this.buffers.get(url);
    if (!p) {
      p = this.loader.loadAsync(this.baseUrl + url).catch((err) => {
        console.warn("[MusicDirector] No se pudo cargar", url, err);
        return null;
      });
      this.buffers.set(url, p);
    }
    return p;
  }
}

function randomIn([min, max]: [number, number]) {
  return min + Math.random() * (max - min);
}

/** Valor aleatorio de un rango interpolado entre `calm` y `tense`. */
function lerpRange(calm: [number, number], tense: [number, number], t: number) {
  const min = THREE.MathUtils.lerp(calm[0], tense[0], t);
  const max = THREE.MathUtils.lerp(calm[1], tense[1], t);
  return min + Math.random() * (max - min);
}
