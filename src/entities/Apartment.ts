import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const loader = new GLTFLoader();

export function loadApartment(scene: THREE.Scene) {
  loader.load("/models/apartment/ModernApartment.glb", (gltf) => {
    scene.add(gltf.scene);
  });
}
