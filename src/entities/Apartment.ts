import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
const loader = new GLTFLoader();

export function loadApartment(scene: THREE.Scene) {
  loader.load("/models/apartment/ModernApartment.glb", (gltf) => {
    scene.add(gltf.scene);
  });
}
