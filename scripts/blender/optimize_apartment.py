"""
Optimiza Zona_2.blend (apartamento) para la web, en Blender en modo fondo.

- NO modifica Zona_2.blend: guarda una copia Zona_2_web.blend.
- Soldado de vértices (Merge by Distance) antes de reducir: los modelos
  vienen con los vértices separados por cara (casi cada triángulo es una
  pieza suelta) y el Decimate, sin conectividad, los destroza.
- Decimate (collapse) en los objetos pesados, como modificador SIN aplicar en
  la copia (se puede ajustar luego) y aplicado al exportar.
- Texturas a 1024 px como máximo.
- Exporta a GLB solo lo visible de ENV_ZONE2 + los COL_* de _COLLISION.

Uso (desde la raíz del proyecto, ~20 s):
  blender -b RUTA/Zona_2.blend --python scripts/blender/optimize_apartment.py
      -- assets-src/models/apartment/ModernApartment.glb RUTA/Zona_2_web.blend
  (todo en una línea)
  pnpm chunk-maps ModernApartment
"""
import bmesh
import bpy
import math
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_GLB, OUT_BLEND = argv[0], argv[1]

MAX_TEX = 1024
DECIMATE_ABOVE = 15000      # triángulos
TARGET_MIN, TARGET_MAX = 4000, 25000
TARGET_RATIO = 0.12

deps = bpy.context.evaluated_depsgraph_get()


def tri_count(ob):
    ev = ob.evaluated_get(deps)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    ev.to_mesh_clear()
    return n


env = bpy.data.collections["ENV_ZONE2"]
col = bpy.data.collections["_COLLISION"]

visual = [o for o in env.all_objects
          if o.type == 'MESH' and not o.hide_render and not o.hide_viewport
          and not o.hide_get()]
colliders = [o for o in col.all_objects if o.type == 'MESH']
skipped = [o.name for o in env.all_objects if o not in visual]

# ── 1. Soldar vértices ───────────────────────────────────────────────────────
MERGE_DIST = 0.0005  # 0.5 mm
SMOOTH_ANGLE = math.radians(35)

welded = set()
for ob in visual:
    me = ob.data
    if me.name in welded:
        continue
    if me.users > 1:
        ob.data = me = me.copy()
    welded.add(me.name)

    # Las normales personalizadas son las que separaban los vértices.
    if me.has_custom_normals:
        with bpy.context.temp_override(object=ob, active_object=ob):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()

    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=MERGE_DIST)
    bm.to_mesh(me)
    bm.free()
    # Sombreado suave salvo en aristas de más de 35º.
    me.set_sharp_from_angle(angle=SMOOTH_ANGLE)

deps = bpy.context.evaluated_depsgraph_get()

# ── 2. Decimate ──────────────────────────────────────────────────────────────
before = after_est = 0
for ob in visual:
    n = tri_count(ob)
    before += n
    if n <= DECIMATE_ABOVE:
        after_est += n
        continue
    target = max(TARGET_MIN, min(TARGET_MAX, int(n * TARGET_RATIO)))
    if ob.data.users > 1:
        ob.data = ob.data.copy()
    mod = ob.modifiers.new("WebDecimate", 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = target / n
    mod.use_collapse_triangulate = True
    after_est += target
    print(f"  decimate {ob.name}: {n} -> ~{target}")

# ── 3. Texturas ──────────────────────────────────────────────────────────────
scaled = 0
for img in bpy.data.images:
    w, h = img.size[:]
    if max(w, h) <= MAX_TEX or w == 0:
        continue
    k = MAX_TEX / max(w, h)
    img.scale(max(1, int(w * k)), max(1, int(h * k)))
    if img.packed_file is not None:
        img.pack()  # re-empaquetar los píxeles reducidos
    scaled += 1

# Huérfanos (Image_61, materiales sin uso…)
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

# ── 4. Exportar ──────────────────────────────────────────────────────────────
# _COLLISION está excluida de la view layer: incluirla para poder seleccionar.
def find_layer_coll(lc, name):
    if lc.collection.name == name:
        return lc
    for child in lc.children:
        found = find_layer_coll(child, name)
        if found:
            return found
    return None

layer_col = find_layer_coll(bpy.context.view_layer.layer_collection, "_COLLISION")
was_excluded = layer_col.exclude
layer_col.exclude = False

bpy.ops.object.select_all(action='DESELECT')
for ob in visual + colliders:
    ob.hide_set(False)
    ob.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=OUT_GLB,
    export_format='GLB',
    use_selection=True,
    export_apply=True,          # aplica el Decimate al exportar
    export_yup=True,
    export_image_format='AUTO',
    export_texcoords=True,
    export_normals=True,
    export_tangents=False,
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
    export_animations=False,
    export_extras=False,
)

layer_col.exclude = was_excluded

# Copia para seguir trabajando en Blender (el original queda intacto).
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, copy=True, compress=True)

print(f"=== RESUMEN visibles={len(visual)} colliders={len(colliders)} "
      f"tris {before} -> ~{after_est} texturas_reducidas={scaled}")
print("=== NO exportados (ocultos):", skipped)
