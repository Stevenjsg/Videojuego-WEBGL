import * as THREE from "three";

export const loadingManager = new THREE.LoadingManager();

export function bindLoadingUI() {
  const root = document.getElementById("loading");
  const fill = document.getElementById(
    "loading-bar-fill",
  ) as HTMLDivElement | null;
  const text = document.getElementById("loading-text") as HTMLDivElement | null;

  if (!root || !fill || !text) return;

  loadingManager.onStart = () => {
    root.classList.remove("hidden");
    fill.style.width = "0%";
    text.textContent = "0%";
  };

  loadingManager.onProgress = (_url, loaded, total) => {
    const p = total > 0 ? Math.round((loaded / total) * 100) : 0;
    fill.style.width = `${p}%`;
    text.textContent = `${p}%`;
  };

  loadingManager.onLoad = () => {
    fill.style.width = "100%";
    text.textContent = "100%";
    // pequeño delay para que no parpadee
    setTimeout(() => root.classList.add("hidden"), 200);
  };

  loadingManager.onError = (url) => {
    text.textContent = `Error cargando: ${url}`;
  };
}
