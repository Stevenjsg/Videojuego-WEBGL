import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type FlashlightConfig = {
  url: string;
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;
  batteryDrainPerSec?: number; // % por segundo (0..1)
};

export class Flashlight {
  public root = new THREE.Group();
  public light: THREE.SpotLight;

  public isOn = false;
  public hasFlashlight = false;

  public battery = 1.0; // 0..1
  private drainPerSec: number;

  private loaded = false;

  constructor(
    private camera: THREE.Camera,
    cfg: FlashlightConfig,
  ) {
    this.drainPerSec = cfg.batteryDrainPerSec ?? 0.02;

    // Luz
    this.light = new THREE.SpotLight(
      0xffffff,
      cfg.intensity ?? 3.0,
      cfg.distance ?? 18,
      cfg.angle ?? 0.45,
      cfg.penumbra ?? 0.6,
      cfg.decay ?? 2,
    );
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.5;
    this.light.shadow.camera.far = cfg.distance ?? 18;

    // Target del spotlight: un objeto delante de cámara
    const targetObj = new THREE.Object3D();
    targetObj.position.set(0, 0, -1);
    this.camera.add(targetObj);
    this.light.target = targetObj;
    this.root.add(this.light);

    // modelo GLB (opcional, puro cosmetic)
    this.loadModel(cfg.url);

    // Por defecto apagada
    this.applyLightState();
  }

  equip() {
    if (this.hasFlashlight) return;
    this.hasFlashlight = true;

    // Montar en cámara (FPS)
    this.camera.add(this.root);

    // posición relativa a la cámara (ajusta a gusto)
    this.root.position.set(0.18, -0.18, -0.35);
    this.root.rotation.set(0, Math.PI / 2, 0);
  }

  toggle() {
    if (!this.hasFlashlight) return;
    if (this.battery <= 0) {
      this.isOn = false;
      this.applyLightState();
      return;
    }
    this.isOn = !this.isOn;
    this.applyLightState();
  }

  addBattery(amount01: number) {
    this.battery = Math.min(1, this.battery + amount01);
    if (this.battery > 0 && this.hasFlashlight) {
      // no auto-encender, lo decides tú
    }
  }

  update(dt: number) {
    if (!this.hasFlashlight) return;

    if (this.isOn) {
      this.battery -= this.drainPerSec * dt;
      if (this.battery <= 0) {
        this.battery = 0;
        this.isOn = false;
        this.applyLightState();
      }
    }

    // (opcional) parpadeo cuando está baja
    const low = this.battery < 0.15;
    if (this.isOn && low) {
      const t = performance.now() * 0.02;
      this.light.intensity = 3.0 * (0.7 + 0.3 * Math.abs(Math.sin(t)));
    }
  }

  private applyLightState() {
    const enabled = this.isOn && this.battery > 0 && this.hasFlashlight;
    this.light.visible = enabled;
  }

  private loadModel(url: string) {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (g) => {
        const model = g.scene;
        model.traverse((c) => {
          if ((c as any).isMesh) {
            const m = c as THREE.Mesh;
            m.castShadow = false;
            m.receiveShadow = false;
          }
        });
        // escalar si hace falta
        model.scale.setScalar(0.1);
        this.root.add(model);
        this.loaded = true;
      },
      undefined,
      (e) => console.error("Flashlight load error:", e),
    );
  }
}
