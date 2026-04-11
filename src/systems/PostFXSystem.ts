import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { FilmPass } from "three/addons/postprocessing/FilmPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export type PostFXConfig = {
  grainIntensity?: number; // 0..1
  grayscale?: boolean;
};

export class PostFXSystem {
  private composer: EffectComposer;
  private film: FilmPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    cfg: PostFXConfig = {},
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.film = new FilmPass(
      cfg.grainIntensity ?? 0.12,
      cfg.grayscale ?? false,
    );
    //this.composer.addPass(this.film);

    // OutputPass es requerido en las versiones más modernas de ThreeJS (r154+) para el color final y evitar feedback loops extraños en WebGL2
    const outputPass = new OutputPass();
    this.composer.addPass(outputPass);
  }

  render() {
    this.composer.render();
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w, h);
  }

  setGrain(intensity: number) {
    // FilmPass expone uniforms en .material.uniforms
    const u = (this.film.material as any).uniforms;
    if (u?.intensity) u.intensity.value = intensity;
  }
}
