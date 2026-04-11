import { loadingManager } from "@/core/assets";
import * as THREE from "three";
import { EXRLoader } from "three/examples/jsm/loaders/EXRLoader.js";

export async function loadEXREnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  exrUrl: string,
  opts?: { setBackground?: boolean; intensity?: number },
) {
  const setBackground = opts?.setBackground ?? false;
  const intensity = opts?.intensity ?? 1.0;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const exrTex = await new Promise<THREE.DataTexture>((resolve, reject) => {
    new EXRLoader(loadingManager).load(exrUrl, resolve, undefined, reject);
  });

  exrTex.mapping = THREE.EquirectangularReflectionMapping;
  exrTex.colorSpace = THREE.LinearSRGBColorSpace;
  exrTex.needsUpdate = true;

  const envRT = pmrem.fromEquirectangular(exrTex);
  const envMap = envRT.texture;

  // Break the render-target association so sampling envMap during
  // EffectComposer passes doesn't trigger a WebGL feedback loop.
  envMap.isRenderTargetTexture = false;

  scene.environment = envMap;
  (scene as any).environmentIntensity = intensity;

  if (setBackground) scene.background = envMap;

  // Limpieza segura:
  exrTex.dispose();
  pmrem.dispose();

  // NO hagas envRT.dispose() aquí.
  // Guárdalo si quieres liberar más tarde al cambiar de HDRI.
  return envRT; // opcional: devuelvo el RT por si quieres guardarlo
}
