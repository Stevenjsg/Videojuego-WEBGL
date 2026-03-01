export const LEVEL1_SPAWN: [number, number, number] = [13.35, 1.7, 3.6];
export type BoxColliderCenterDef = {
  name: string;
  center: [number, number, number];
  size: [number, number, number]; // ancho (x), alto (y), fondo (z)
};

export const LEVEL1_COLLIDERS: BoxColliderCenterDef[] = [
  { name: "wall_north", center: [3.8, 1.5, -1.612], size: [21, 3, 0.3] }, //pared cocina
  { name: "armarios_cocina", center: [-3.2, 1.5, -0.8], size: [6.5, 3, 0.4] },
  { name: "nevera", center: [3, 1.5, -0.758], size: [6, 3, 0.5] },

  { name: "wall_south", center: [2.91, 1.5, 4.44], size: [18.81, 3, 0.01] }, //pared gatos
  { name: "wall_south2", center: [13.95, 1.5, 4.44], size: [0.7, 3, 0.01] },
  { name: "wall_west", center: [-6.5, 1.5, 2.5], size: [0.01, 3, 8] }, //ventanal
  { name: "wall_east", center: [14.5, 1.5, 2.5], size: [0.3, 3, 8] },

  //Paredes interiores
  { name: "wall_hall", center: [2.65, 1.5, 2.55], size: [2.1, 3, 0.2] },
  { name: "wall_hall1", center: [7.65, 1.5, 2.55], size: [4, 3, 0.2] },
  { name: "wall_hall2", center: [13, 1.5, 2.55], size: [2.9, 3, 0.2] },
  { name: "wall_desk", center: [6.35, 1.5, 0.5], size: [0.1, 3, 4] },
  { name: "wall_badroom", center: [9.42, 1.5, -0.7], size: [0.4, 3, 1.7] }, //armario
  { name: "wall_badroom1", center: [9.46, 1.5, 1.9], size: [0.4, 3, 1.2] }, //zapatos
  { name: "wall_hall1", center: [7.75, 1.5, 2], size: [2.8, 3, 0.4] },

  //table
  { name: "table", center: [0.04, 0.9, 1.53], size: [1.9, 0.01, 1] },
  //sillas
  { name: "chair1", center: [0.5, 0.65, 0.9], size: [0.3, 0.01, 0.3] },
  { name: "chair2", center: [-0.25, 0.65, 0.9], size: [0.3, 0.01, 0.3] },
  { name: "chair3", center: [0.5, 0.65, 2.1], size: [0.3, 0.01, 0.3] },
  { name: "chair4", center: [-0.25, 0.65, 2.1], size: [0.3, 0.01, 0.3] },
  {
    name: "saloon_chair1",
    center: [-3.48, 0.65, 1.08],
    size: [0.4, 0.01, 0.45],
  },
  {
    name: "saloon_chair2",
    center: [-2.4, 0.65, 1.88],
    size: [0.4, 0.01, 0.5],
  },
  { name: "table_saloon", center: [-4, 0.55, 2.3], size: [1.2, 0.01, 0.7] },

  { name: "sofa", center: [-3.85, 0.45, 3.9], size: [3.3, 0.45, 0.7] },
  { name: "sofa", center: [-6, 0.45, 2.15], size: [0.7, 0.45, 2.2] },

  { name: "cama", center: [13, 0.4, 0.55], size: [2.5, 0.6, 1.5] },
  { name: "wall_east", center: [13.8, 0.4, 1.5], size: [0.3, 1, 5.5] },

  { name: "maceta1", center: [7.9, 0.3, 2.96], size: [0.3, 0.6, 0.3] },
  { name: "maceta2", center: [2.45, 0.3, 2.15], size: [0.3, 0.6, 0.3] },
  { name: "maceta3", center: [-1.95, 0.3, 4], size: [0.3, 0.6, 0.3] },

  { name: "mampara", center: [7.3, 1.5, -0.24], size: [1.4, 3, 0.01] },
  { name: "vater", center: [6.8, 0.3, 0.325], size: [0.7, 0.6, 0.5] },
  { name: "vater", center: [6.75, 0.4, 1.2], size: [0.5, 0.8, 1] },
];
export const PICKUPS = [
  { type: "flashlight", pos: [0.5, 0.9, 2.0], scale: 1.0 },
  { type: "battery", pos: [2.5, 0.9, -1.0], scale: 1.0, amount: 0.25 },
  { type: "battery", pos: [-3.0, 0.9, 1.2], scale: 1.0, amount: 0.25 },
] as const;
