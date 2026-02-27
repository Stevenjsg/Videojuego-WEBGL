export const LEVEL1_SPAWN: [number, number, number] = [13, 1.7, 3.45];
export type BoxColliderCenterDef = {
  name: string;
  center: [number, number, number];
  size: [number, number, number]; // ancho (x), alto (y), fondo (z)
};

export const LEVEL1_COLLIDERS: BoxColliderCenterDef[] = [
  { name: "wall_north", center: [3.8, 1.5, -1.612], size: [21, 3, 0.3] }, //pared cocina
  { name: "wall_south", center: [2.91, 1.5, 4.44], size: [18.81, 3, 0.01] }, //pared gatos
  { name: "wall_west", center: [-6.5, 1.5, 4.1], size: [0.01, 3, 8] }, //ventanal
  { name: "wall_east", center: [14.5, 1.5, 2.5], size: [0.3, 3, 8] },

  //Paredes interiores
  { name: "wall_hall", center: [2.65, 1.5, 2.55], size: [2.1, 3, 0.2] },
  { name: "wall_hall1", center: [7.65, 1.5, 2.55], size: [4, 3, 0.2] },
  { name: "wall_hall2", center: [13, 1.5, 2.55], size: [2.8, 3, 0.2] },
  { name: "wall_desk", center: [6.35, 1.5, 0.5], size: [0.1, 3, 4] },
  { name: "wall_badroom", center: [9.42, 1.5, -0.7], size: [0.4, 3, 1.7] }, //armario
  { name: "wall_badroom1", center: [9.46, 1.5, 1.9], size: [0.4, 3, 1.2] }, //zapatos
  { name: "wall_hall1", center: [7.75, 1.5, 2], size: [2.8, 3, 0.4] },

  //table
  { name: "table", center: [0.04, 0.85, 1.53], size: [1.9, 0.01, 1] },
];
