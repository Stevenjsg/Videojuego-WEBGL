/**
 * Distancia máxima de visión (m). La niebla es opaca a esta distancia y la
 * cámara no dibuja más allá; los chunks dentro de ella se cargan antes de
 * empezar, así no se ve aparecer el mapa.
 */
const VIEW_DISTANCE = 20;

export const GAME = {
  PIXEL_RATIO_CAP: 1.5,
  VIEW_DISTANCE,

  /** Estética PlayStation 1 (ver systems/PS1Effect.ts). */
  PS1: {
    ENABLED: true,
    /** Resolución vertical interna (px). */
    HEIGHT: 240,
    /** Bits por canal (5 = color de 15 bits como la PS1). */
    COLOR_BITS: 5,
    /** Rejilla de snapping de vértices (más bajo = más temblor). */
    SNAP_GRID: 120,
  },

  LIGHTING: {
    /** Exposición del tone mapping (ACES). */
    EXPOSURE: 0.9,
    /** Luz ambiental hemisférica: cielo frío arriba, suelo cálido abajo. */
    SKY_COLOR: 0x8c94b4,
    GROUND_COLOR: 0x2e2622,
    /** Bajo a propósito: la oscuridad la rompen las lámparas y la linterna. */
    AMBIENT_INTENSITY: 0.22,
    FOG_COLOR: 0x08080c,
    /** La niebla empieza aquí y es opaca en VIEW_DISTANCE. */
    FOG_NEAR: 2,
  },

  PLAYER: {
    HEIGHT: 1.8,
    RADIUS: 0.3,
    BASE_SPEED: 1.5,
    SUBSTEPS: 2,
    HP: 3,
  },

  ENEMY: {
    URL: "/models/enemy/azure_automaton.glb",
    SCALE: 0.85,
    SPEED: 2,
    CATCH_DISTANCE: 1.2,
    HIT_GRACE_SECONDS: 2.5,
    SPAWN: { x: 5.7, y: 0.2, z: 0.5 },
    /** Rango de detección base (sin correr) */
    DETECTION_RANGE: 8,
    /** Rango de detección extra si el player corre */
    DETECTION_RANGE_RUNNING: 14,
    /** Segundos que el enemy busca en la última posición conocida */
    SEARCH_DURATION: 4,
    /** Agente de la navmesh (ver NavMeshSystem). RADIUS = Enemy.radius */
    NAV: { RADIUS: 0.45, HEIGHT: 1.8, MAX_CLIMB: 0.4 },
  },

  LEVEL1: {
    /** Generado con `pnpm chunk-maps` desde ModernApartment.glb */
    URL: "/models/apartment/chunks/manifest.json",
    DEBUG: false,
    POS: { x: -3.22, y: 0, z: 30.5 },
    /** Metros alrededor del jugador que deben estar cargados al entrar. */
    GATE_RADIUS: VIEW_DISTANCE,
  },
  LEVEL1_ZONE1: {
    /** Generado con `pnpm chunk-maps` desde Zona1.glb */
    URL: "/models/Zona1/chunks/manifest.json",
    POS: { x: 0, y: 0, z: 0 },
    DEBUG: false,
  },
  UI: {
    ITEMS_TOTAL: 5,
  },

  HDRI: {
    URL: "/hdri/qwantani_dusk_2_puresky_2k.exr",
    INTENSITY: 0.02,
  },
};
