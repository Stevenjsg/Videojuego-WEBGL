import { loadingManager } from "@/core/assets";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type PickupType = "flashlight" | "battery";

export type PickupConfig = {
  type: PickupType;
  url: string;
  position: THREE.Vector3;
  scale?: number;
  batteryAmount?: number; // solo para battery
};

export class Pickup {
  public root = new THREE.Group();

  constructor(public cfg: PickupConfig) {
    this.root.position.copy(cfg.position);
    this.load(cfg.url, cfg.scale ?? 1);
  }

  get type() {
    return this.cfg.type;
  }

  get batteryAmount() {
    return this.cfg.batteryAmount ?? 0.25;
  }

  private load(url: string, scale: number) {
    const loader = new GLTFLoader(loadingManager);
    loader.load(
      url,
      (g) => {
        const model = g.scene;
        model.scale.setScalar(scale);
        this.root.add(model);
      },
      undefined,
      (e) => console.error("Pickup load error:", e),
    );
  }
}
