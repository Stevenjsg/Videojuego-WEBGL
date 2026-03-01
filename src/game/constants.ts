export const GAME = {
  PIXEL_RATIO_CAP: 1.5,

  PLAYER: {
    HEIGHT: 1.7,
    RADIUS: 0.3,
    BASE_SPEED: 1.5,
    SUBSTEPS: 3,
  },

  ENEMY: {
    URL: "/models/enemy/azure_automaton.glb",
    SCALE: 0.6,
    SPEED: 1.5,
    CATCH_DISTANCE: 1.0,
    WATCH_DOT: 0.1,
    SPAWN: { x: -7.55, y: 0, z: 3.6 },
  },

  LEVEL1: {
    URL: "/models/apartment/ModernApartment.glb",
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
