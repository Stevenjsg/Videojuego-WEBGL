import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

/**
 * Tubo fluorescente: luz rectangular del tamaño del tubo apuntando hacia
 * abajo (la luz sale *del* tubo, no de un punto) y cristal emisivo.
 *
 * El parpadeo va sincronizado con el sonido: se precalcula la envolvente de
 * volumen del AudioBuffer y, mientras suena, cada chasquido del audio hace
 * que el tubo falle. No depende del volumen ni de la distancia al jugador.
 */

export type FluorescentLampConfig = {
  color?: THREE.ColorRepresentation;
  /** Luminancia de la RectAreaLight (nits). */
  intensity?: number;
  /** Brillo del cristal del tubo. */
  emissiveIntensity?: number;
};

/** Resolución de la envolvente (muestras por segundo). */
const ENVELOPE_RATE = 60;
/** Un chasquido es >= este múltiplo del volumen típico del zumbido. */
const CLICK_RATIO = 2.5;
/** A partir de este múltiplo el tubo se apaga del todo en ese instante. */
const FULL_FLICKER_RATIO = 7;
/** Muestras que "aguanta" un fallo: el tubo tarda en volver a encender. */
const RESTRIKE_SAMPLES = 4;

let rectLightsReady = false;

export class FluorescentLamp {
  readonly light: THREE.RectAreaLight;
  /** Centro del tubo en mundo (para colocar el audio). */
  readonly center = new THREE.Vector3();

  private glass: THREE.MeshStandardMaterial | null = null;
  private baseIntensity: number;
  private baseEmissive: number;

  private envelope: Float32Array | null = null;
  private soundStart = -1;
  private context: AudioContext | null = null;

  constructor(
    scene: THREE.Scene,
    tube: THREE.Mesh,
    cfg: FluorescentLampConfig = {},
  ) {
    if (!rectLightsReady) {
      RectAreaLightUniformsLib.init();
      rectLightsReady = true;
    }

    const color = new THREE.Color(cfg.color ?? 0xd6e4ff);
    this.baseIntensity = cfg.intensity ?? 12;
    this.baseEmissive = cfg.emissiveIntensity ?? 2.5;

    // Tamaño y posición desde la caja del cristal del tubo.
    tube.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(tube);
    const size = box.getSize(new THREE.Vector3());
    box.getCenter(this.center);

    // El lado largo del tubo define la orientación del rectángulo.
    const alongX = size.x >= size.z;
    this.light = new THREE.RectAreaLight(
      color,
      this.baseIntensity,
      Math.max(size.x, size.z),
      Math.max(0.05, Math.min(size.x, size.z)),
    );
    // Justo bajo el cristal, mirando al suelo. rotation.x = -90º lleva el -Z
    // local (dirección de emisión) a -Y; el ancho queda en X local.
    this.light.position.set(this.center.x, box.min.y - 0.01, this.center.z);
    this.light.rotation.set(-Math.PI / 2, 0, alongX ? 0 : Math.PI / 2, "YXZ");
    scene.add(this.light);

    // Cristal emisivo propio (el material "Glass" puede estar compartido).
    const mat = tube.material as THREE.MeshStandardMaterial;
    if (mat?.isMeshStandardMaterial) {
      this.glass = mat.clone();
      this.glass.emissive.copy(color);
      this.glass.emissiveIntensity = this.baseEmissive;
      tube.material = this.glass;
    }
  }

  /** Precalcula la envolvente RMS del sonido para sincronizar el parpadeo. */
  setSound(buffer: AudioBuffer, context: AudioContext) {
    this.context = context;
    const data = buffer.getChannelData(0);
    const win = Math.max(1, Math.round(buffer.sampleRate / ENVELOPE_RATE));
    const env = new Float32Array(Math.ceil(data.length / win));
    for (let i = 0; i < env.length; i++) {
      let sum = 0;
      const end = Math.min(data.length, (i + 1) * win);
      for (let s = i * win; s < end; s++) sum += data[s] * data[s];
      env[i] = Math.sqrt(sum / win);
    }
    // Normalizar por la mediana (volumen típico del zumbido).
    const median = Float32Array.from(env).sort()[env.length >> 1] || 1e-4;
    for (let i = 0; i < env.length; i++) env[i] /= median;
    this.envelope = env;
  }

  /** Llamar cuando empieza a sonar (tiempo del AudioContext). */
  soundStarted() {
    if (this.context) this.soundStart = this.context.currentTime;
  }

  soundEnded() {
    this.soundStart = -1;
  }

  update() {
    const level = this.currentLevel();
    this.light.intensity = this.baseIntensity * level;
    if (this.glass) {
      // El cristal nunca queda del todo negro: el tubo sigue algo caliente.
      this.glass.emissiveIntensity = this.baseEmissive * (0.15 + 0.85 * level);
    }
  }

  /** 1 = encendido normal, 0 = apagado. */
  private currentLevel(): number {
    if (!this.envelope || !this.context || this.soundStart < 0) return 1;

    const t = this.context.currentTime - this.soundStart;
    const i = Math.floor(t * ENVELOPE_RATE);
    if (i < 0 || i >= this.envelope.length) return 1;

    // Pico reciente (con caída) para que los chasquidos cortos se vean.
    let ratio = this.envelope[i];
    for (let k = 1; k <= RESTRIKE_SAMPLES && i - k >= 0; k++) {
      ratio = Math.max(ratio, this.envelope[i - k] * (1 - k * 0.12));
    }
    if (ratio < CLICK_RATIO) {
      // Zumbido normal: casi constante, con un leve temblor.
      return 1 - 0.04 * Math.max(0, ratio - 1);
    }

    // Chasquido: el tubo falla. Cuanto más fuerte, más se apaga, con
    // tartamudeo aleatorio para que no sea un fundido suave.
    const strength = Math.min(
      1,
      (ratio - CLICK_RATIO) / (FULL_FLICKER_RATIO - CLICK_RATIO),
    );
    const stutter = Math.random() < 0.5 ? 1 : 0.35;
    return Math.max(0.03, 1 - strength * stutter);
  }

  dispose() {
    this.light.removeFromParent();
    this.light.dispose();
    this.glass?.dispose();
  }
}
