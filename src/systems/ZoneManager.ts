import * as THREE from "three";
import { downloadWithProgress } from "@core/download";
import { loadGLBFromBlob } from "@core/gltfFromBlob";
import { setupLevelMeshes } from "@world/Level1";
import { CollisionSystem } from "./CollisionSystem";

export type ZoneConfig = {
  id: string;
  url: string;
  position: THREE.Vector3;
  triggerBox: THREE.Box3; // Jugador dentro de esta caja => cargar. Fuera => descargar.
  onLoad?: (root: THREE.Object3D, colliders: THREE.Box3[]) => void;
  onUnload?: () => void;
  loadPromise?: Promise<void>;
  isLoaded: boolean;
  rootObject: THREE.Object3D | null;
  colliders: THREE.Box3[];
};

export class ZoneManager {
  private zones = new Map<string, ZoneConfig>();

  constructor(
    private scene: THREE.Scene,
    private collisionSystem: CollisionSystem,
    private onZoneProgress: (ratio: number) => void,
    private setStage: (msg: string) => void
  ) {}

  public addZone(config: Omit<ZoneConfig, "isLoaded" | "rootObject" | "colliders" | "loadPromise">) {
    this.zones.set(config.id, {
      ...config,
      isLoaded: false,
      rootObject: null,
      colliders: [],
    });
  }

  public update(playerPos: THREE.Vector3) {
    for (const [id, zone] of this.zones.entries()) {
      const inTrigger = zone.triggerBox.containsPoint(playerPos);

      // Si entramos al trigger y no está cargada ni cargando
      if (inTrigger && !zone.isLoaded && !zone.loadPromise) {
        this.loadZone(zone);
      }
      // Si salimos del trigger y está cargada
      else if (!inTrigger && zone.isLoaded && zone.rootObject && !zone.loadPromise) {
        this.unloadZone(zone);
      }
    }
  }

  private async loadZone(zone: ZoneConfig) {
    console.log(`[ZoneManager] Loading zone: ${zone.id}`);
    
    zone.loadPromise = (async () => {
      try {
        const blob = await downloadWithProgress(zone.url, (p) => {
          if (p.ratio != null) this.onZoneProgress(p.ratio);
        });

        const root = await loadGLBFromBlob(blob, this.setStage);
        root.position.copy(zone.position);
        
        // Evitar fallos de actualización estática
        root.traverse((o) => { o.matrixAutoUpdate = true; });
        root.updateMatrixWorld(true);

        this.scene.add(root);
        zone.rootObject = root;

        // Generar colisiones
        zone.colliders = setupLevelMeshes(root);

        zone.isLoaded = true;
        
        // Refresh de todas las colisiones globales para inyectarlas
        this.refreshGlobalCollisions();

        if (zone.onLoad) zone.onLoad(root, zone.colliders);
        console.log(`[ZoneManager] Finished loading zone: ${zone.id}`);
      } catch (err) {
        console.error(`[ZoneManager] Error loading zone ${zone.id}:`, err);
      } finally {
        zone.loadPromise = undefined; // Liberar cerrojo
      }
    })();
  }

  private unloadZone(zone: ZoneConfig) {
    console.log(`[ZoneManager] Unloading zone: ${zone.id}`);
    if (zone.rootObject) {
      this.scene.remove(zone.rootObject);
      
      // Limpiar geometría y materiales para liberar RAM/VRAM
      zone.rootObject.traverse((obj: any) => {
        if (obj.isMesh) {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m: any) => m.dispose());
            } else {
              obj.material.dispose();
            }
          }
        }
      });

      zone.rootObject = null;
    }

    zone.colliders = [];
    zone.isLoaded = false;
    
    // Quitar del motor de físicas
    this.refreshGlobalCollisions();

    if (zone.onUnload) zone.onUnload();
    console.log(`[ZoneManager] Unloaded zone: ${zone.id}`);
  }

  public getAllDynamicColliders(): THREE.Box3[] {
    const list: THREE.Box3[] = [];
    for (const zone of this.zones.values()) {
      if (zone.isLoaded) list.push(...zone.colliders);
    }
    return list;
  }

  // Permite inyectar las colisiones dinámicas actualizadas en el Game.ts
  public onCollisionsChanged: (() => void) | null = null;
  private refreshGlobalCollisions() {
    if (this.onCollisionsChanged) this.onCollisionsChanged();
  }
}
