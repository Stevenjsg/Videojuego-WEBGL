import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createPS1ColorPass } from "./PS1Effect";

export type PostFXConfig = {
  /** Reservado para extensiones futuras (grain, vignette…). */
  grainIntensity?: number;
  grayscale?: boolean;
  /** Bits por canal para el look PS1 (con tramado). Omitir para desactivar. */
  ps1ColorBits?: number;
};

export class PostFXSystem {
  private composer: EffectComposer;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    cfg: PostFXConfig = {},
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // OutputPass es necesario en r154+ para el color final correcto.
    this.composer.addPass(new OutputPass());

    // Después del OutputPass: el tramado se hace sobre el color ya en sRGB,
    // que es lo que ve el jugador.
    if (cfg.ps1ColorBits) {
      this.composer.addPass(createPS1ColorPass(cfg.ps1ColorBits));
    }
  }

  render() {
    this.composer.render();
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  /** EffectComposer guarda el pixel ratio al crearse: hay que avisarle. */
  setPixelRatio(ratio: number) {
    this.composer.setPixelRatio(ratio);
  }
}
