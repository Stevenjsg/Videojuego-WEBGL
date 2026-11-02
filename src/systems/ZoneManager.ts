import * as THREE from "three";
import { downloadWithProgress } from "@core/download";
import { loadGLBFromBlob } from "@core/gltfFromBlob";
import { setupLevelMeshes } from "@world/Level1";
import { ChunkedLevel } from "@world/ChunkedLevel";
import { CollisionSystem } from "./CollisionSystem";

export type ZoneConfig = {
  id: string;
  url: string;
  position: THREE.Vector3;
  /** Giro en Y (rad) de la zona. */
  rotationY?: number;
  triggerBox: THREE.Box3; // Jugador dentro de esta caja => cargar. Fuera => descargar.
  onLoad?: (root: THREE.Object3D, colliders: THREE.Box3[]) => void;
  onUnload?: () => void;
  /** Solo zonas por chunks (url = manifest.json): por cada chunk añadido. */
  onChunk?: (chunk: THREE.Object3D) => void;
  /** Solo zonas por chunks: metros alrededor del jugador antes de `onLoad`. */
  gateRadius?: number;
  loadPromise?: Promise<void>;
  /** Cargada con forceLoadZone: el trigger no la descarga automáticamente. */
  forced?: boolean;
  isLoaded: boolean;
  rootObject: THREE.Object3D | null;
  level: ChunkedLevel | null;
  colliders: THREE.Box3[];
};

export class ZoneManager {
  private zones = new Map<string, ZoneConfig>();
  /** Última posición del jugador: prioriza qué chunk se descarga primero. */
  private focus = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private collisionSystem: CollisionSystem,
    private onZoneProgress: (ratio: number) => void,
    private setStage: (msg: string) => void,
    private renderer?: THREE.WebGLRenderer,
  ) {}

  public addZone(config: Omit<ZoneConfig, "isLoaded" | "rootObject" | "level" | "colliders" | "loadPromise">) {
    this.zones.set(config.id, {
      ...config,
      isLoaded: false,
      rootObject: null,
      level: null,
      colliders: [],
    });
  }

  public update(playerPos: THREE.Vector3) {
    this.focus.copy(playerPos);
    for (const [id, zone] of this.zones.entries()) {
      const inTrigger = zone.triggerBox.containsPoint(playerPos);

      // Si entramos al trigger y no está cargada ni cargando
      if (inTrigger && !zone.isLoaded && !zone.loadPromise) {
        this.loadZone(zone);
      }
      // Si salimos del trigger y está cargada
      else if (!inTrigger && !zone.forced && zone.isLoaded && zone.rootObject && !zone.loadPromise) {
        this.unloadZone(zone);
      }
    }
  }

  private async loadZone(zone: ZoneConfig) {
    console.log(`[ZoneManager] Loading zone: ${zone.id}`);
    
    zone.loadPromise = (async () => {
      try {
        if (zone.url.endsWith(".json")) {
          await this.loadChunkedZone(zone);
          return;
        }

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

  /** Core (colliders) primero, luego chunks por cercanía al jugador. */
  private async loadChunkedZone(zone: ZoneConfig) {
    const level = new ChunkedLevel({
      manifestUrl: zone.url,
      renderer: this.renderer,
      onChunk: (chunk) => {
        setupLevelMeshes(chunk);
        zone.onChunk?.(chunk);
      },
    });
    level.root.position.copy(zone.position);
    level.root.rotation.y = zone.rotationY ?? 0;
    this.scene.add(level.root);
    zone.level = level;
    zone.rootObject = level.root;

    try {
      const core = await level.loadCore();
      zone.colliders = setupLevelMeshes(core);
      zone.onChunk?.(core);
    } catch (err) {
      level.dispose();
      zone.level = null;
      zone.rootObject = null;
      throw err;
    }

    zone.isLoaded = true;
    this.refreshGlobalCollisions();

    await level.stream({
      focus: () => this.focus,
      gateRadius: zone.gateRadius ?? 8,
      onProgress: this.onZoneProgress,
    });

    if (level !== zone.level) return; // descargada mientras cargaba
    if (zone.onLoad) zone.onLoad(level.root, zone.colliders);
    console.log(`[ZoneManager] Finished loading zone: ${zone.id}`);
  }

  private unloadZone(zone: ZoneConfig) {
    console.log(`[ZoneManager] Unloading zone: ${zone.id}`);
    if (zone.level) {
      zone.level.dispose();
      zone.level = null;
      zone.rootObject = null;
    } else if (zone.rootObject) {
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

  /** Force-load a zone regardless of trigger box position. */
  public forceLoadZone(id: string) {
    const zone = this.zones.get(id);
    if (!zone) return;
    zone.forced = true;
    if (zone.isLoaded || zone.loadPromise) return;
    this.loadZone(zone);
  }

  /** Force-unload a zone regardless of trigger box position. */
  public forceUnloadZone(id: string) {
    const zone = this.zones.get(id);
    if (!zone) return;
    zone.forced = false;
    if (!zone.isLoaded || !zone.rootObject) return;
    this.unloadZone(zone);
  }

  /** Caja que envuelve los colliders de una zona cargada (o null). */
  public getZoneBounds(id: string): THREE.Box3 | null {
    const zone = this.zones.get(id);
    if (!zone?.isLoaded || zone.colliders.length === 0) return null;
    const box = new THREE.Box3();
    for (const c of zone.colliders) box.union(c);
    return box;
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
