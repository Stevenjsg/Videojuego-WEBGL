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
    SCALE: 0.6,
    SPEED: 2.8,
    CATCH_DISTANCE: 0.5,
    HIT_GRACE_SECONDS: 2.5,
    SPAWN: { x: 5.7, y: 0.2, z: 0.5 },
    /** Rango de detección base (sin correr) */
    DETECTION_RANGE: 8,
    /** Rango de detección extra si el player corre */
    DETECTION_RANGE_RUNNING: 14,
    /** Segundos que el enemy busca en la última posición conocida */
    SEARCH_DURATION: 4,
    /** Segundos de freeze máximo antes de romperlo */
    FREEZE_BREAK_TIME: 1.5,
  },

  LEVEL1: {
    URL: "/models/apartment/ModernApartment.glb",
    DEBUG: false,
    POS: { x: -3.22, y: 0, z: 30.5 },
  },
  LEVEL1_ZONE1: {
    URL: "/models/Zona1/Zona1.glb",
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
