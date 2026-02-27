import * as THREE from "three";

const HINTS = ["wall", "floor", "ground", "stairs", "roof", "ceiling"];

// Excluir cosas problemáticas
const DENY = ["door", "window", "glass", "sprayedwalltexture"];

export function extractColliders(root: THREE.Object3D) {
  const solid: THREE.Object3D[] = [];

  root.traverse((child) => {
    if (!(child as any).isMesh) return;
    const mesh = child as THREE.Mesh;

    const name = (mesh.name || "").toLowerCase();
    const marked = mesh.userData?.collider === true;
    const hinted = HINTS.some((k) => name.includes(k));
    const denied = DENY.some((k) => name.includes(k));

    if (!(marked || hinted) || denied) return;

    // Filtro por tamaño: fuera cajas enormes tipo “shell”
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;

    const worldBB = bb.clone().applyMatrix4(mesh.matrixWorld);
    const s = new THREE.Vector3();
    worldBB.getSize(s);

    const volume = s.x * s.y * s.z;

    // Ajuste: tu gigante era ~340, así que esto lo caza
    if (volume > 150) return;

    // Opcional: ignora suelos (si controlas y con playerHeight)
    // Si prefieres colisionar con suelo más adelante, quita esto
    if (name.includes("floor") || name.includes("ground")) return;

    solid.push(mesh);
  });

  return solid;
}
