import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export type PostFXConfig = {
  /** Reservado para extensiones futuras (grain, vignette…). */
  grainIntensity?: number;
  grayscale?: boolean;
};

export class PostFXSystem {
  private composer: EffectComposer;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    _cfg: PostFXConfig = {},
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // OutputPass es necesario en r154+ para el color final correcto.
    this.composer.addPass(new OutputPass());
  }

  render() {
    this.composer.render();
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }
}
