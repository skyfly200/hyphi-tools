"""Import a hyphi-tools folding animation bundle into Blender.

Usage (Blender, Scripting tab or CLI):
    blender --python tools/blender/import_folding_bundle.py -- /path/to/bundle [--rigid]

Check mode (no Blender needed):
    python3 tools/blender/import_folding_bundle.py --check /path/to/bundle

Bundle files: assembly.json, mesh-topology.json, configurations.json, diagnostics.json.
Units: the bundle is in millimetres. The scene is set to 1 Blender unit = 1 mm so
dimensions in Blender match the source design exactly.

Builds, with FIXED topology:
  * one mesh object with material-coordinate UVs and a vertex group + material per part
  * one shape key per solved configuration (keyed so the timeline plays the sequence)
  * timeline markers carrying each step's title; instructions stored as custom properties
  * --rigid: additionally one empty per region with keyframed rigid transforms
"""
import json
import os
import sys


def load_bundle(path):
    def rd(name):
        with open(os.path.join(path, name), "r", encoding="utf-8") as f:
            return json.load(f)
    b = {
        "assembly": rd("assembly.json"),
        "topology": rd("mesh-topology.json"),
        "configs": rd("configurations.json")["configurations"],
        "diagnostics": rd("diagnostics.json"),
    }
    if b["assembly"].get("units") != "mm":
        raise ValueError("bundle units must be mm, got %r" % b["assembly"].get("units"))
    n = b["topology"]["vertexCount"]
    for c in b["configs"]:
        if len(c["positions"]) != 3 * n:
            raise ValueError("configuration %s has %d coords, expected %d (topology changed within segment)"
                             % (c["id"], len(c["positions"]), 3 * n))
    return b


def extent_mm(positions):
    xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]
    return [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]


def check(path):
    b = load_bundle(path)
    return {
        "configs": len(b["configs"]),
        "vertexCount": b["topology"]["vertexCount"],
        "triangles": len(b["topology"]["indices"]) // 3,
        "extentMm": [extent_mm(c["positions"]) for c in b["configs"]],
        "steps": [(s["id"], s["startFrame"], s["endFrame"]) for s in b["assembly"]["steps"]],
        "units": b["assembly"]["units"],
    }


def build_in_blender(path, rigid=False):
    import bpy  # noqa: F401  (only available inside Blender)

    b = load_bundle(path)
    topo, configs = b["topology"], b["configs"]
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 0.001   # 1 BU = 1 mm
    scene.unit_settings.length_unit = "MILLIMETERS"
    scene.render.fps = int(b["assembly"].get("fps", 24))

    verts = [tuple(configs[0]["positions"][i:i + 3]) for i in range(0, len(configs[0]["positions"]), 3)]
    faces = [tuple(topo["indices"][i:i + 3]) for i in range(0, len(topo["indices"]), 3)]
    mesh = bpy.data.meshes.new("FoldAssembly")
    mesh.from_pydata(verts, [], faces)
    mesh.update()

    uv = mesh.uv_layers.new(name="Material")
    uvs = topo["uvs"]
    for loop in mesh.loops:
        v = loop.vertex_index
        uv.data[loop.index].uv = (uvs[2 * v], uvs[2 * v + 1])

    obj = bpy.data.objects.new("FoldAssembly", mesh)
    scene.collection.objects.link(obj)
    obj["hyphi_geometry_hash"] = b["assembly"]["geometryHash"]

    for i, part in enumerate(topo["parts"]):
        mat = bpy.data.materials.new("part:%s" % part["id"])
        mesh.materials.append(mat)
        for t in range(part["triStart"], part["triStart"] + part["triCount"]):
            mesh.polygons[t].material_index = i
        vg = obj.vertex_groups.new(name=part["id"])
        vg.add(list(range(part["vertexStart"], part["vertexStart"] + part["vertexCount"])), 1.0, "REPLACE")

    # Shape keys: basis = first configuration; each later one is keyed 0 -> 1 -> 0 around its frame.
    obj.shape_key_add(name=configs[0]["id"], from_mix=False)
    frames = [c["frame"] for c in configs]
    for idx, c in enumerate(configs):
        if idx == 0:
            continue
        key = obj.shape_key_add(name=c["id"], from_mix=False)
        for vi in range(topo["vertexCount"]):
            key.data[vi].co = tuple(c["positions"][3 * vi:3 * vi + 3])
        key.value = 0.0
        key.keyframe_insert("value", frame=frames[idx - 1] if frames[idx - 1] != frames[idx] else frames[idx] - 1)
        key.value = 1.0
        key.keyframe_insert("value", frame=frames[idx])
        if idx + 1 < len(configs):
            key.value = 0.0
            key.keyframe_insert("value", frame=frames[idx + 1])

    for s in b["assembly"]["steps"]:
        scene.timeline_markers.new(s["title"], frame=s["startFrame"])
        obj["step:%s" % s["id"]] = s.get("instruction") or s.get("notes") or ""
    scene.frame_start = 0
    scene.frame_end = max(frames)

    if rigid:
        for rid in configs[0]["rigid"]:
            e = bpy.data.objects.new("region:%s" % rid, None)
            scene.collection.objects.link(e)
            for c in configs:
                R, t = c["rigid"][rid]["R"], c["rigid"][rid]["t"]
                e.matrix_world = ((R[0], R[1], R[2], t[0]), (R[3], R[4], R[5], t[1]), (R[6], R[7], R[8], t[2]), (0, 0, 0, 1))
                e.keyframe_insert("location", frame=c["frame"])
                e.keyframe_insert("rotation_euler", frame=c["frame"])
    return obj


def main(argv):
    if "--check" in argv:
        print(json.dumps(check(argv[argv.index("--check") + 1])))
        return
    args = argv[argv.index("--") + 1:] if "--" in argv else argv[1:]
    paths = [a for a in args if not a.startswith("--")]
    if not paths:
        raise SystemExit("usage: ... -- <bundle dir> [--rigid]")
    build_in_blender(paths[0], rigid="--rigid" in args)


if __name__ == "__main__":
    main(sys.argv)
