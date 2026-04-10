import * as THREE from "three";

const _raycaster = new THREE.Raycaster();
const _dir = new THREE.Vector3();

export function hasLineOfSight(
  from: THREE.Vector3,
  to: THREE.Vector3,
  objects: THREE.Object3D[],
  opts?: { near?: number; far?: number },
) {
  const dir = _dir.subVectors(to, from);
  const dist = dir.length();
  if (dist <= 0.0001) return true;

  dir.normalize();

  _raycaster.near = opts?.near ?? 0;
  _raycaster.far = opts?.far ?? dist;
  _raycaster.set(from, dir);

  const hits = _raycaster.intersectObjects(objects, true);
  if (hits.length === 0) return true;

  // si el primer hit está antes que el target, no hay line-of-sight
  return hits[0].distance >= dist - 1e-3;
}
