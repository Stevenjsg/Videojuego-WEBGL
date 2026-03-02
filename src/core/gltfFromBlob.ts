import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export async function loadGLBFromBlob(
  blob: Blob,
  onStage?: (s: string) => void,
) {
  onStage?.("Procesando modelo…");

  const arrayBuffer = await blob.arrayBuffer();
  const loader = new GLTFLoader();

  return await new Promise<THREE.Object3D>((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      "", // path base para recursos embebidos (ok en GLB)
      (gltf) => resolve(gltf.scene),
      reject,
    );
  });
}
