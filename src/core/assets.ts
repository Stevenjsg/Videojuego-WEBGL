import * as THREE from "three";

/**
 * Manager compartido por los modelos que se cargan "por su cuenta" (enemy,
 * linterna, pickups, HDRI). La pantalla de carga la controla Game; aquí solo
 * se expone cuándo han terminado.
 */
export const loadingManager = new THREE.LoadingManager();

let inFlight = false;
let onProgress: ((ratio: number) => void) | null = null;
const waiters: Array<() => void> = [];

loadingManager.onStart = () => {
  inFlight = true;
};

loadingManager.onProgress = (_url, loaded, total) => {
  inFlight = loaded < total;
  onProgress?.(total > 0 ? loaded / total : 1);
};

loadingManager.onLoad = () => {
  inFlight = false;
  onProgress = null;
  waiters.splice(0).forEach((resolve) => resolve());
};

loadingManager.onError = (url) => {
  console.error(`Error cargando: ${url}`);
};

/** Resuelve cuando no queda nada pendiente en `loadingManager`. */
export function whenAssetsLoaded(
  progress?: (ratio: number) => void,
): Promise<void> {
  if (!inFlight) return Promise.resolve();
  onProgress = progress ?? null;
  return new Promise((resolve) => waiters.push(resolve));
}
