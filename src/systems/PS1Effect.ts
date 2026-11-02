import * as THREE from "three";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";

/**
 * Estética PlayStation 1, todo en GPU (shaders):
 *
 * - Baja resolución: el juego se renderiza a ~240 px de alto y el canvas se
 *   escala sin suavizado (ver Game.applyPixelRatio).
 * - Vértices que tiemblan: la posición en pantalla se ajusta a una rejilla
 *   gruesa, como la GTE de la PS1 (sin subpíxeles).
 * - Color de 15 bits (5 por canal) con tramado Bayer 4x4.
 */

export type PS1Config = {
  /** Resolución vertical interna (px). La PS1 solía usar 240. */
  height: number;
  /** Bits por canal de color. La PS1 usaba 5 (15 bits en total). */
  colorBits: number;
  /** Celdas de la rejilla de snapping en vertical (más bajo = más temblor). */
  snapGrid: number;
};

let snappingInstalled = false;

/**
 * Parchea el chunk `project_vertex` de three para ajustar cada vértice a la
 * rejilla. Afecta a todos los materiales estándar, así que debe llamarse una
 * vez antes de compilar ninguno.
 */
export function installVertexSnapping(snapGrid: number) {
  if (snappingInstalled) return;
  snappingInstalled = true;

  // Rejilla en NDC (-1..1). En horizontal se asume ~16:9.
  const gx = ((snapGrid * 16) / 9).toFixed(1);
  const gy = snapGrid.toFixed(1);

  THREE.ShaderChunk.project_vertex += /* glsl */ `
// PS1: snapping de vértices a la rejilla de pantalla
{
  vec2 ps1Grid = vec2( ${gx}, ${gy} );
  gl_Position.xy = floor( gl_Position.xy / gl_Position.w * ps1Grid + 0.5 )
    / ps1Grid * gl_Position.w;
}
`;
}

/** Pase final: reduce a `colorBits` por canal con tramado ordenado. */
export function createPS1ColorPass(colorBits: number) {
  return new ShaderPass({
    name: "PS1ColorPass",
    uniforms: {
      tDiffuse: { value: null },
      levels: { value: Math.pow(2, colorBits) - 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float levels;
      varying vec2 vUv;

      // Matriz Bayer 4x4 normalizada a [0, 1)
      float bayer4( vec2 p ) {
        ivec2 i = ivec2( mod( p, 4.0 ) );
        int idx = i.x + i.y * 4;
        int m[16] = int[16]( 0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5 );
        return float( m[idx] ) / 16.0;
      }

      void main() {
        vec3 color = texture2D( tDiffuse, vUv ).rgb;
        float threshold = bayer4( gl_FragCoord.xy ) - 0.5;
        color = floor( color * levels + 0.5 + threshold ) / levels;
        gl_FragColor = vec4( clamp( color, 0.0, 1.0 ), 1.0 );
      }
    `,
  });
}
