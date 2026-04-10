import * as THREE from "three";

export function createRenderer(mount: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // MSAA is wasted when rendering through EffectComposer
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(mount.clientWidth, mount.clientHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft is 4x more expensive
  mount.appendChild(renderer.domElement);
  return renderer;
}
