/**
 * Divide los mapas GLB en chunks espaciales comprimidos para cargarlos por
 * streaming (ver src/world/ChunkedLevel.ts).
 *
 * Uso:  pnpm chunk-maps            (todas las zonas)
 *       pnpm chunk-maps Zona1      (solo una)
 *
 * Salida por zona (en `out`):
 *   manifest.json     → lista de chunks con su bounding sphere
 *   core.gltf/.bin    → colliders (col_), spawns (Spawn_*) y nodos lógicos.
 *                       Sin cuantizar para no alterar nombres ni transforms.
 *   c_X_Z.gltf/.bin   → geometría visual de cada celda XZ (meshopt + cuantizada)
 *   tex_<hash>.webp   → texturas compartidas entre chunks (se descargan una vez)
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  cloneDocument,
  dedup,
  getBounds,
  meshopt,
  prune,
  reorder,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

/** Nodos que deben vivir en el chunk core (lógica de juego, no visual). */
const CORE_BASE = [/^col_/i, /spawn_/i, /fuse_box/i];

const ZONES = [
  {
    name: "Zona1",
    src: "assets-src/models/Zona1/Zona1.glb",
    out: "public/models/Zona1/chunks",
    cellSize: 10,
    // El suelo de transición se consulta por nombre en Game.isPlayerOnTransitionFloor
    // y el tubo fluorescente se usa para colocar su luz (FluorescentLamp).
    core: [...CORE_BASE, /SM_Safe_Floor_4x4\.093/, /Tube-Lamp/i],
    textureSize: 1024,
    simplifyError: 0.0001,
  },
  {
    name: "ModernApartment",
    src: "assets-src/models/apartment/ModernApartment.glb",
    out: "public/models/apartment/chunks",
    cellSize: 5,
    core: CORE_BASE,
    textureSize: 1024,
    simplifyError: 0.0005,
  },
];

await Promise.all([
  MeshoptDecoder.ready,
  MeshoptEncoder.ready,
  MeshoptSimplifier.ready,
]);

const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
  "meshopt.decoder": MeshoptDecoder,
  "meshopt.encoder": MeshoptEncoder,
});

const only = process.argv[2];
for (const zone of ZONES) {
  if (only && zone.name !== only) continue;
  await buildZone(zone);
}

async function buildZone(zone) {
  const t0 = performance.now();
  console.log(`\n▶ ${zone.name}: ${zone.src}`);

  const doc = await io.read(zone.src);

  // Optimización global una sola vez (las texturas se comparten entre chunks).
  await doc.transform(
    dedup(),
    // keepLeaves: los Spawn_* son empties sin mesh y deben sobrevivir.
    prune({ keepLeaves: true, keepAttributes: false }),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, error: zone.simplifyError }),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [zone.textureSize, zone.textureSize],
      quality: 82,
    }),
    // Imágenes distintas en origen pueden quedar idénticas tras redimensionar.
    dedup(),
  );

  // Clasificar cada nodo con mesh: core o celda XZ según el centro de su AABB.
  const nodes = doc.getRoot().listNodes();
  const isCore = (name) => zone.core.some((re) => re.test(name));
  /** @type {Map<string, Set<number>>} */
  const cells = new Map();
  const coreSet = new Set();

  nodes.forEach((node, i) => {
    if (!node.getMesh()) return;
    if (isCore(node.getName())) {
      coreSet.add(i);
      return;
    }
    const { min, max } = getBounds(node);
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const id = `c_${Math.floor(cx / zone.cellSize)}_${Math.floor(cz / zone.cellSize)}`;
    if (!cells.has(id)) cells.set(id, new Set());
    cells.get(id).add(i);
  });

  await rm(zone.out, { recursive: true, force: true });
  await mkdir(zone.out, { recursive: true });

  const manifest = { version: 1, core: null, chunks: [] };

  manifest.core = await writeChunk(doc, "core", coreSet, zone, { core: true });
  for (const [id, set] of cells) {
    manifest.chunks.push(await writeChunk(doc, id, set, zone, { core: false }));
  }

  await writeFile(
    path.join(zone.out, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const total = await dirSize(zone.out);
  const src = (await stat(zone.src)).size;
  console.log(
    `✔ ${zone.name}: ${manifest.chunks.length} chunks + core, ` +
      `${mb(src)} → ${mb(total)} en ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );
}

/**
 * Clona el documento, deja solo los meshes de `keep` y lo escribe como
 * .gltf + .bin con texturas externas compartidas.
 */
async function writeChunk(source, id, keep, zone, { core }) {
  const doc = cloneDocument(source).setLogger(source.getLogger());
  const scenes = doc.getRoot().listScenes();
  const nodes = doc.getRoot().listNodes();

  const keepNode = new Set();
  nodes.forEach((n, i) => {
    if (keep.has(i)) keepNode.add(n);
    // En core también van los empties (spawns, marcadores, luces).
    else if (core && !n.getMesh()) keepNode.add(n);
  });

  // Post-orden: un nodo sobrevive si se conserva o tiene hijos que sobreviven.
  const visit = (node) => {
    let alive = keepNode.has(node);
    for (const child of node.listChildren()) {
      if (visit(child)) alive = true;
    }
    if (!keepNode.has(node)) node.setMesh(null);
    if (!alive) node.dispose();
    return alive;
  };
  for (const scene of scenes) {
    for (const child of scene.listChildren()) visit(child);
  }

  await doc.transform(prune({ keepLeaves: true, keepAttributes: false }));

  // El core no se cuantiza: quantize mueve meshes a nodos hijo sin nombre y
  // altera transforms, lo que rompería col_/Fuse_Box/spawns.
  if (core) {
    await doc.transform(reorder({ encoder: MeshoptEncoder }));
  } else {
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  }

  // Texturas: nombre por hash de contenido → mismo archivo para todos los chunks.
  for (const tex of doc.getRoot().listTextures()) {
    const hash = createHash("sha1").update(tex.getImage()).digest("hex");
    tex.setURI(`tex_${hash.slice(0, 12)}.webp`);
  }
  for (const buf of doc.getRoot().listBuffers()) buf.setURI(`${id}.bin`);

  // Bounding sphere (espacio local del modelo) para priorizar por distancia.
  const sceneBounds = doc.getRoot().listScenes().map(getBounds);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of sceneBounds) {
    for (let k = 0; k < 3; k++) {
      if (Number.isFinite(b.min[k])) min[k] = Math.min(min[k], b.min[k]);
      if (Number.isFinite(b.max[k])) max[k] = Math.max(max[k], b.max[k]);
    }
  }
  const hasBounds = min.every(Number.isFinite);
  const center = hasBounds ? min.map((v, k) => (v + max[k]) / 2) : [0, 0, 0];
  const radius = hasBounds
    ? Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2
    : 0;

  const file = `${id}.gltf`;
  await io.write(path.join(zone.out, file), doc);

  const bytes =
    (await stat(path.join(zone.out, file))).size +
    (await stat(path.join(zone.out, `${id}.bin`)).catch(() => ({ size: 0 }))).size;

  console.log(
    `  ${id.padEnd(10)} meshes=${String(keep.size).padStart(4)}  ${mb(bytes)}`,
  );

  return {
    id,
    url: file,
    center: center.map(round),
    radius: round(radius),
    bytes,
  };
}

async function dirSize(dir) {
  let total = 0;
  for (const f of await readdir(dir)) total += (await stat(path.join(dir, f))).size;
  return total;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function round(v) {
  return Math.round(v * 1000) / 1000;
}
