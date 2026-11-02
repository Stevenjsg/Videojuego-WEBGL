export const GAME = {
  PIXEL_RATIO_CAP: 1.5,

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
  },

  LEVEL1: {
    /** Generado con `pnpm chunk-maps` desde ModernApartment.glb */
    URL: "/models/apartment/chunks/manifest.json",
    DEBUG: false,
    POS: { x: -3.22, y: 0, z: 30.5 },
    /** Metros alrededor del jugador que deben estar cargados al entrar. */
    GATE_RADIUS: 6,
  },
  LEVEL1_ZONE1: {
    /** Generado con `pnpm chunk-maps` desde Zona1.glb */
    URL: "/models/Zona1/chunks/manifest.json",
    POS: { x: 0, y: 0, z: 0 },
    /** Metros alrededor del spawn que deben estar cargados antes de jugar. */
    GATE_RADIUS: 12,
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
