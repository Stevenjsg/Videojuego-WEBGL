import * as THREE from "three";

/**
 * Recorre el modelo cargado, extrae los colliders marcados con `col_` y
 * configura las propiedades de sombras del resto de meshes.
 *
 * Devuelve los Box3 (mundo) de cada collider para alimentar al CollisionSystem.
 */
export function setupLevelMeshes(root: THREE.Object3D): THREE.Box3[] {
  const colliders: THREE.Box3[] = [];
  root.traverse((node: any) => {
    if (!node.isMesh) return;

    if (typeof node.name === "string" && node.name.toLowerCase().startsWith("col_")) {
      node.geometry.computeBoundingBox();
      colliders.push(new THREE.Box3().setFromObject(node));
      node.visible = false;
      return;
    }

    node.castShadow = false;
    node.receiveShadow = true;
  });
  return colliders;
}
