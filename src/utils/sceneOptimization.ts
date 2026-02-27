import * as THREE from "three";

export function optimizeStaticScene(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child as any).isMesh) return;

    const mesh = child as THREE.Mesh;

    // Sombras: caro que todo proyecte
    mesh.castShadow = false;
    mesh.receiveShadow = true;

    // Si algún material viene transparente por error:
    const mat = mesh.material as any;
    if (Array.isArray(mat)) {
      mat.forEach((m) => fixMaterial(m));
    } else {
      fixMaterial(mat);
    }
  });
}

function fixMaterial(m: any) {
  if (!m) return;
  m.transparent = !!m.transparent; // respeta si de verdad lo es
  // Puedes forzar cosas aquí si tu modelo lo necesita:
  m.depthWrite = true;
}
