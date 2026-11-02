import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

/**
 * Carga por streaming de mapas divididos en chunks (scripts/chunk-maps.mjs).
 *
 * 1. `loadCore()`  → colliders, spawns y nodos lógicos (bloqueante).
 * 2. `stream()`    → chunks visuales ordenados por distancia al foco. La
 *    promesa resuelve cuando los chunks dentro de `gateRadius` están listos;
 *    el resto sigue cargando en segundo plano.
 *
 * Las texturas son archivos .webp compartidos entre chunks: se cachean por
 * URL para que cada una se decodifique y suba a la GPU una sola vez.
 */

export type ChunkInfo = {
  id: string;
  url: string;
  center: [number, number, number];
  radius: number;
  bytes: number;
};

type Manifest = {
  version: number;
  core: ChunkInfo;
  chunks: ChunkInfo[];
};

export type ChunkedLevelOptions = {
  manifestUrl: string;
  /** Si se pasa, las texturas se suben a la GPU antes de añadir el chunk. */
  renderer?: THREE.WebGLRenderer;
  /** Descargas simultáneas. */
  concurrency?: number;
  /** Se llama por cada chunk visual añadido a `root` (no para el core). */
  onChunk?: (chunk: THREE.Object3D, info: ChunkInfo) => void;
};

export type StreamOptions = {
  /** Posición (mundo) que decide qué chunk se carga primero. */
  focus: () => THREE.Vector3;
  /** Distancia en metros que debe estar cargada para resolver la promesa. */
  gateRadius: number;
  onProgress?: (ratio: number) => void;
};

type TextureCache = Map<string, Promise<THREE.Texture | null>>;

export class ChunkedLevel {
  readonly root = new THREE.Group();

  private loader = new GLTFLoader();
  private textures: TextureCache = new Map();
  private uploaded = new WeakSet<THREE.Texture>();
  private manifest: Manifest | null = null;
  private baseUrl: string;
  private pending: ChunkInfo[] = [];
  private active = 0;
  private commitChain: Promise<void> = Promise.resolve();
  private disposed = false;
  private focus: () => THREE.Vector3 = () => new THREE.Vector3();
  private onSettled: ((info: ChunkInfo) => void) | null = null;
  private releaseGate: (() => void) | null = null;
  private resolveComplete!: () => void;

  /** Resuelve cuando todos los chunks (no solo los del gate) están cargados. */
  readonly complete = new Promise<void>((r) => (this.resolveComplete = r));

  constructor(private opts: ChunkedLevelOptions) {
    this.baseUrl = opts.manifestUrl.slice(
      0,
      opts.manifestUrl.lastIndexOf("/") + 1,
    );
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader.register(
      (parser) => new SharedTexturePlugin(parser, this.textures),
    );
  }

  async loadCore(): Promise<THREE.Object3D> {
    const res = await fetch(this.opts.manifestUrl);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} cargando ${this.opts.manifestUrl}`);
    }
    this.manifest = (await res.json()) as Manifest;

    const gltf = await this.loader.loadAsync(
      this.baseUrl + this.manifest.core.url,
    );
    const core = gltf.scene;
    core.name = `chunk:${this.manifest.core.id}`;
    this.root.add(core);
    this.root.updateMatrixWorld(true);
    return core;
  }

  stream(opts: StreamOptions): Promise<void> {
    if (!this.manifest) throw new Error("ChunkedLevel: llama a loadCore()");
    this.focus = opts.focus;
    this.pending = [...this.manifest.chunks];

    this.root.updateMatrixWorld(true);
    const start = opts.focus().clone();
    const gate = new Set(
      this.pending.filter((c) => this.distanceTo(c, start) <= opts.gateRadius),
    );
    const gateBytes = [...gate].reduce((sum, c) => sum + c.bytes, 0);
    let doneBytes = 0;

    const gateDone = new Promise<void>((resolve) => {
      this.releaseGate = resolve;
      if (gate.size === 0) return resolve();
      this.onSettled = (info) => {
        if (!gate.delete(info)) return;
        doneBytes += info.bytes;
        opts.onProgress?.(gateBytes > 0 ? doneBytes / gateBytes : 1);
        if (gate.size === 0) resolve();
      };
    });

    if (this.pending.length === 0) this.resolveComplete();
    this.pump();
    return gateDone;
  }

  /** Detiene descargas pendientes y libera geometría, materiales y texturas. */
  dispose() {
    this.disposed = true;
    this.pending.length = 0;
    // No dejar colgado a quien espera el gate o la carga completa.
    this.releaseGate?.();
    this.resolveComplete();
    this.root.removeFromParent();
    disposeObject(this.root);
    for (const p of this.textures.values()) p.then((t) => t?.dispose());
    this.textures.clear();
  }

  /**
   * Descarga en segundo plano (prioridad baja) todos los archivos de un mapa
   * para que estén en la caché HTTP cuando se necesiten.
   */
  static async prefetch(manifestUrl: string) {
    const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
    const get = (url: string) =>
      fetch(url, { priority: "low" } as RequestInit).catch(() => null);
    try {
      const manifest = (await (await fetch(manifestUrl)).json()) as Manifest;
      const seen = new Set<string>();
      for (const chunk of [manifest.core, ...manifest.chunks]) {
        const res = await get(base + chunk.url);
        if (!res?.ok) continue;
        const json = await res.json();
        const uris: string[] = [
          ...(json.buffers ?? []).map((b: { uri?: string }) => b.uri),
          ...(json.images ?? []).map((i: { uri?: string }) => i.uri),
        ];
        for (const uri of uris) {
          if (!uri || seen.has(uri)) continue;
          seen.add(uri);
          await get(base + uri);
        }
      }
    } catch (err) {
      console.warn("[ChunkedLevel] prefetch falló:", err);
    }
  }

  // ── Internos ─────────────────────────────────────────────────────────────

  private pump() {
    const max = this.opts.concurrency ?? 3;
    while (!this.disposed && this.active < max && this.pending.length > 0) {
      const next = this.takeNearest();
      this.active++;
      this.loadChunk(next).finally(() => {
        this.active--;
        this.onSettled?.(next);
        this.pump();
        if (this.active === 0 && this.pending.length === 0) {
          this.resolveComplete();
        }
      });
    }
  }

  private takeNearest(): ChunkInfo {
    const focus = this.focus();
    this.root.updateMatrixWorld();
    let best = 0;
    let bestDist = Infinity;
    this.pending.forEach((c, i) => {
      const d = this.distanceTo(c, focus);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return this.pending.splice(best, 1)[0];
  }

  /** Distancia desde `point` (mundo) a la esfera del chunk. */
  private distanceTo(chunk: ChunkInfo, point: THREE.Vector3) {
    _center.fromArray(chunk.center).applyMatrix4(this.root.matrixWorld);
    return Math.max(0, _center.distanceTo(point) - chunk.radius);
  }

  private async loadChunk(info: ChunkInfo) {
    try {
      const gltf = await this.loader.loadAsync(this.baseUrl + info.url);
      const chunk = gltf.scene;
      chunk.name = `chunk:${info.id}`;

      // Un chunk por frame para repartir la subida de texturas a la GPU.
      const commit = this.commitChain.then(nextFrame).then(() => {
        if (this.disposed) {
          disposeObject(chunk);
          return;
        }
        this.uploadTextures(chunk);
        this.root.add(chunk);
        chunk.updateMatrixWorld(true);
        this.opts.onChunk?.(chunk, info);
      });
      this.commitChain = commit;
      await commit;
    } catch (err) {
      console.error(`[ChunkedLevel] Error cargando chunk ${info.id}:`, err);
    }
  }

  private uploadTextures(obj: THREE.Object3D) {
    const renderer = this.opts.renderer;
    if (!renderer) return;
    forEachTexture(obj, (tex) => {
      if (this.uploaded.has(tex)) return;
      this.uploaded.add(tex);
      renderer.initTexture(tex);
    });
  }
}

const _center = new THREE.Vector3();

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function forEachTexture(
  obj: THREE.Object3D,
  fn: (tex: THREE.Texture) => void,
) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const m of materials) {
      for (const value of Object.values(m)) {
        if ((value as THREE.Texture)?.isTexture) fn(value as THREE.Texture);
      }
    }
  });
}

function disposeObject(obj: THREE.Object3D) {
  forEachTexture(obj, (tex) => tex.dispose());
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((m) => m?.dispose());
  });
}

/**
 * Comparte texturas entre chunks: misma URL + sampler → misma THREE.Texture.
 *
 * Se registra con el nombre `EXT_texture_webp` a propósito: GLTFLoader indexa
 * los plugins por nombre, así que este reemplaza al plugin nativo de WebP
 * (que crearía una textura nueva por cada archivo .gltf).
 */
class SharedTexturePlugin {
  readonly name = "EXT_texture_webp";

  // GLTFParser no expone en sus tipos los métodos internos que usamos.
  constructor(
    private parser: any,
    private cache: TextureCache,
  ) {}

  loadTexture(textureIndex: number) {
    const json = this.parser.json;
    const def = json.textures[textureIndex];
    const sourceIndex: number | undefined =
      def.extensions?.EXT_texture_webp?.source ?? def.source;
    if (sourceIndex === undefined) return null;

    const image = json.images[sourceIndex];
    const loader = this.parser.textureLoader;
    if (!image.uri) {
      return this.parser.loadTextureImage(textureIndex, sourceIndex, loader);
    }

    const url = THREE.LoaderUtils.resolveURL(
      image.uri,
      this.parser.options.path,
    );
    const sampler = JSON.stringify(json.samplers?.[def.sampler] ?? {});
    const key = `${url}|${sampler}`;

    let promise = this.cache.get(key);
    if (!promise) {
      promise = this.parser.loadTextureImage(
        textureIndex,
        sourceIndex,
        loader,
      ) as Promise<THREE.Texture | null>;
      this.cache.set(key, promise);
    }
    return promise;
  }
}
