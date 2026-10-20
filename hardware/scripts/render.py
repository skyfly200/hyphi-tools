#!/usr/bin/env python3
"""Render product views in Blender from a product.yaml `render:` section.

    pip install bpy pyyaml
    python3 render.py <product.yaml> [--variant NAME] [--out DIR]

Or inside a Blender install (its Python needs pyyaml):
    blender -b -P render.py -- <product.yaml> [--variant NAME] [--out DIR]

Inputs come from the spec: the board model (`kicad-cli pcb export glb` output),
plus any Blender-authored models (enclosure, petals, diffusers). Paths in the
spec are relative to the spec file. Writes one PNG per view.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
import yaml
from mathutils import Vector

# Camera directions per named view: (azimuth deg, elevation deg).
VIEWS = {
    "hero": (35, 30),
    "top": (0, 89.9),
    "front": (0, 0),
    "side": (90, 0),
    "back": (180, 20),
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("spec")
    ap.add_argument("--variant")
    ap.add_argument("--out", help="output dir (default: <spec dir>/build/renders)")
    return ap.parse_args(argv)


def merged(base, override):
    out = dict(base)
    for k, v in (override or {}).items():
        out[k] = merged(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new("World")
    return scene


def import_model(path):
    before = set(bpy.data.objects)
    ext = path.suffix.lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif ext == ".stl":
        bpy.ops.wm.stl_import(filepath=str(path))
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=str(path))
    elif ext == ".blend":
        with bpy.data.libraries.load(str(path)) as (src, dst):
            dst.objects = src.objects
        for ob in dst.objects:
            bpy.context.scene.collection.objects.link(ob)
    else:
        sys.exit(f"unsupported model type: {path}")
    return [ob for ob in bpy.data.objects if ob not in before]


def bounds(objects):
    pts = [ob.matrix_world @ Vector(c) for ob in objects if ob.type == "MESH" for c in ob.bound_box]
    if not pts:
        sys.exit("no meshes imported")
    lo = Vector(map(min, *[(p.x, p.y, p.z) for p in pts]))
    hi = Vector(map(max, *[(p.x, p.y, p.z) for p in pts]))
    return (lo + hi) / 2, (hi - lo).length / 2


def add_light(name, kind, energy, loc, size=None):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    if size:
        data.size = size
    ob = bpy.data.objects.new(name, data)
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    return ob


def aim(ob, target):
    ob.rotation_euler = (target - ob.location).to_track_quat("-Z", "Y").to_euler()


def setup(scene, cfg, center, radius):
    scene.render.engine = "CYCLES" if cfg.get("engine") == "cycles" else "BLENDER_EEVEE_NEXT"
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = cfg.get("samples", 64)
        scene.cycles.device = "CPU"
    w, h = cfg.get("resolution", [1600, 1200])
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.film_transparent = cfg.get("transparent", True)
    scene.world.color = (0.02, 0.02, 0.025)

    d = radius * 4
    for name, energy, (x, y, z) in [("key", 1200, (1, -1, 1.2)), ("fill", 400, (-1.2, -0.6, 0.6)),
                                    ("rim", 800, (0, 1.2, 1))]:
        light = add_light(name, "AREA", energy * radius ** 2, center + Vector((x, y, z)) * d, size=radius)
        aim(light, center)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = cfg.get("lens", 85)
    cam.data.clip_end = d * 10
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def place_camera(cam, view, center, radius):
    az, el = VIEWS[view]
    az, el = math.radians(az), math.radians(el)
    fov = cam.data.angle
    dist = radius / math.sin(fov / 2) * 1.1
    cam.location = center + dist * Vector((math.sin(az) * math.cos(el),
                                           -math.cos(az) * math.cos(el),
                                           math.sin(el)))
    aim(cam, center)


def main():
    args = parse_args()
    spec_path = Path(args.spec).resolve()
    spec = yaml.safe_load(spec_path.read_text())
    variant = args.variant or "default"
    cfg = merged(spec.get("render") or {}, ((spec.get("variants") or {}).get(variant) or {}).get("render"))
    if not cfg.get("models"):
        sys.exit("spec has no render.models")

    scene = reset_scene()
    objects = []
    for rel in cfg["models"]:
        path = spec_path.parent / rel
        if not path.exists():
            sys.exit(f"missing model: {path} (export the board with `kicad-cli pcb export glb`)")
        objects += import_model(path)

    center, radius = bounds(objects)
    cam = setup(scene, cfg, center, radius)
    out = Path(args.out) if args.out else spec_path.parent / "build" / "renders"
    out.mkdir(parents=True, exist_ok=True)
    pid = spec["product"]["id"]
    for view in cfg.get("views", ["hero"]):
        if view not in VIEWS:
            sys.exit(f"unknown view {view!r}; known: {', '.join(VIEWS)}")
        place_camera(cam, view, center, radius)
        scene.render.filepath = str(out / f"{pid}-{variant}-{view}.png")
        bpy.ops.render.render(write_still=True)
        print(f"wrote {scene.render.filepath}")


if __name__ == "__main__":
    main()
