import { loadingManager } from "@/core/assets";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type FlashlightConfig = {
  url: string;

  // light
  intensity?: number;
  distance?: number;
  angle?: number;
  penumbra?: number;
  decay?: number;

  // battery
  batteryDrainPerSec?: number;

  // equip (visual placement)
  equipPos?: THREE.Vector3;
  modelScale?: number;

  // muzzle tuning (local space inside root)
  muzzlePos?: THREE.Vector3; // donde está la bombilla/cristal
  targetDistance?: number; // a qué distancia apunta el cono
};

export class Flashlight {
  public root = new THREE.Group();

  public isOn = false;
  public hasFlashlight = false;

  public battery = 1.0; // 0..1

  public light: THREE.SpotLight;

  private drainPerSec: number;

  private model: THREE.Object3D | null = null;

  // “muzzle” (punta) y “target” (punto al que apunta)
  private muzzle = new THREE.Object3D();
  private target = new THREE.Object3D();

  // cache params
  private baseIntensity: number;

  constructor(
    private camera: THREE.Camera,
    cfg: FlashlightConfig,
  ) {
    this.drainPerSec = cfg.batteryDrainPerSec ?? 0.02;

    this.baseIntensity = cfg.intensity ?? 3.0;

    // Root: lo colgaremos de la cámara al equipar
    // Creamos muzzle y target dentro del root
    this.root.add(this.muzzle);
    this.root.add(this.target);

    // Posiciones por defecto (ajustables)
    const equipPos = cfg.equipPos ?? new THREE.Vector3(0.18, -0.18, -0.35);
    this.root.position.copy(equipPos);

    const muzzlePos = cfg.muzzlePos ?? new THREE.Vector3(0.0, -0.02, -0.18);
    this.muzzle.position.copy(muzzlePos);

    const targetDistance = cfg.targetDistance ?? 2.5;
    this.target.position.set(0, 0, -targetDistance);

    // Luz: como hija del muzzle => sale de la punta
    this.light = new THREE.SpotLight(
      0xffffff,
      this.baseIntensity,
      cfg.distance ?? 18,
      cfg.angle ?? 0.45,
      cfg.penumbra ?? 0.6,
      cfg.decay ?? 2,
    );

    this.light.castShadow = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.camera.near = 0.5;
    this.light.shadow.camera.far = cfg.distance ?? 18;

    // Montaje: muzzle contiene la luz, root contiene el target
    this.muzzle.add(this.light);
    this.light.position.set(0, 0, 0);

    this.light.target = this.target;

    // Modelo GLB (cosmético)
    this.loadModel(cfg.url, cfg.modelScale ?? 0.1);

    // Arranca apagada
    this.applyLightState();
  }

  equip() {
    if (this.hasFlashlight) return;
    this.hasFlashlight = true;

    // Se monta en la cámara
    this.camera.add(this.root);

    // Ajuste visual del modelo sin afectar al muzzle/target
    if (this.model) {
      // típica corrección de orientación de assets
      this.model.rotation.set(-Math.PI / 2, Math.PI, 0);
      this.model.position.set(0, 0, 0);
    }

    // Muy importante: el target necesita estar en la escena para que SpotLight lo “lea”
    // (al estar root colgado de cámara, target también lo está, perfecto)
    this.target.updateMatrixWorld(true);
    this.light.target.updateMatrixWorld(true);
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
  }

  update(dt: number) {
    if (!this.hasFlashlight) return;

    // Asegura matrices (target y muzzle)
    this.muzzle.updateMatrixWorld(true);
    this.target.updateMatrixWorld(true);
    this.light.target.updateMatrixWorld(true);

    if (this.isOn) {
      this.battery -= this.drainPerSec * dt;
      if (this.battery <= 0) {
        this.battery = 0;
        this.isOn = false;
        this.applyLightState();
      }
    }

    // Parpadeo cuando la batería está baja
    const low = this.battery < 0.15;
    if (this.isOn && low) {
      const t = performance.now() * 0.02;
      this.light.intensity =
        this.baseIntensity * (0.7 + 0.3 * Math.abs(Math.sin(t)));
    } else {
      this.light.intensity = this.baseIntensity;
    }
  }

  private applyLightState() {
    const enabled = this.hasFlashlight && this.isOn && this.battery > 0;
    this.light.visible = enabled;
  }

  private loadModel(url: string, scale: number) {
    const loader = new GLTFLoader(loadingManager);
    loader.load(
      url,
      (g) => {
        this.model = g.scene;

        this.model.traverse((c) => {
          if ((c as any).isMesh) {
            const m = c as THREE.Mesh;
            m.castShadow = false;
            m.receiveShadow = false;
          }
        });

        this.model.scale.setScalar(scale);

        // El modelo cuelga del root (no del muzzle), para que puedas ajustar muzzle independiente
        this.root.add(this.model);
      },
      undefined,
      (e) => console.error("Flashlight load error:", e),
    );
  }
}
