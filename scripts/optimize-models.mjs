/**
 * Optimiza modelos sueltos (props) que se cargan con un GLTFLoader normal.
 *
 * Uso:  pnpm optimize-models
 *
 * Sin meshopt/Draco para no necesitar decoders en el runtime: solo reduce
 * triángulos (meshoptimizer) y pasa las texturas a WebP (EXT_texture_webp,
 * soportado de serie por GLTFLoader). Los originales viven en assets-src/.
 */
import { stat } from "node:fs/promises";
import { Logger, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  inspect,
  prune,
  simplify,
  textureCompress,
  weld,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

const MODELS = [
  {
    // 34k triángulos para algo que se ve pequeño en la mano.
    src: "assets-src/models/assets/flashlight.glb",
    out: "public/models/assets/flashlight.glb",
    ratio: 0.1,
    error: 0.005,
    textureSize: 512,
  },
];

await MeshoptSimplifier.ready;
const io = new NodeIO()
  .setLogger(new Logger(Logger.Verbosity.WARN))
  .registerExtensions(ALL_EXTENSIONS);

for (const m of MODELS) {
  const doc = await io.read(m.src);
  const before = triangles(doc);

  await doc.transform(
    dedup(),
    prune({ keepAttributes: false }),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: m.ratio, error: m.error }),
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [m.textureSize, m.textureSize],
      quality: 85,
    }),
  );

  await io.write(m.out, doc);
  const kb = async (p) => ((await stat(p)).size / 1024).toFixed(0) + " KB";
  console.log(
    `✔ ${m.out}: ${before} → ${triangles(doc)} triángulos, ` +
      `${await kb(m.src)} → ${await kb(m.out)}`,
  );
}

function triangles(doc) {
  return inspect(doc).meshes.properties.reduce((n, p) => n + p.glPrimitives, 0);
}
