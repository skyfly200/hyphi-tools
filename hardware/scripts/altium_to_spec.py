#!/usr/bin/env python3
"""Draft a product.yaml from an EasyEDA Pro "Altium" (ASCII) board export.

    altium_to_spec.py <board dir> --id ID --name NAME [--out product.yaml]

<board dir> holds one *.pcbdoc and a folder of *.schdoc sheets, as EasyEDA Pro
writes them. KiCad's Altium importer reads only binary Altium files, so this
reads the ASCII records directly and pulls out what the spec needs: the BOM
(LCSC numbers, JLCPCB Basic/Extended class, DNP flags), board outline, copper
layers, design rule sizes and the placement of every part.
"""
import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import yaml

MIL_TO_MM = 0.0254


def records(path):
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    for line in re.split(r"\r\n|\r|\n", text):
        if line.startswith("|"):
            # Non-ASCII values come as %UTF8%KEY=...; fold them onto the plain key.
            yield dict(kv.replace("%UTF8%", "").split("=", 1) for kv in line.strip("|").split("|") if "=" in kv)


def mm(mil_str):
    return round(float(mil_str.replace("mil", "")) * MIL_TO_MM, 3)


def schematic_parts(sheets):
    parts = []
    for sheet in sheets:
        body = list(records(sheet))[1:]  # first record is the HEADER; OWNERINDEX counts after it
        comps = {i: {} for i, r in enumerate(body) if r.get("RECORD") == "1"}
        for r in body:
            owner = comps.get(int(r.get("OWNERINDEX", -1)))
            if owner is None:
                continue
            if r.get("RECORD") in ("34", "41") and "NAME" in r:
                owner.setdefault(r["NAME"], r.get("TEXT", ""))
            elif r.get("RECORD") == "45" and r.get("ISCURRENT") == "T":
                owner["_footprint"] = r.get("MODELNAME")
        parts += comps.values()
    return parts


def board(pcb):
    recs = list(records(pcb))
    b = next(r for r in recs if r.get("RECORD") == "Board" and "VX0" in r)
    pts = [(mm(b[f"VX{i}"]), mm(b[f"VY{i}"])) for i in range(len(b)) if f"VX{i}" in b]
    x0, y1 = min(p[0] for p in pts), max(p[1] for p in pts)
    # Altium is Y-up; KiCad is Y-down from the top-left corner.
    flip = lambda x, y: [round(x - x0, 3), round(y1 - y, 3)]
    outline = []
    for p in (flip(*p) for p in pts):
        if not outline or max(abs(p[0] - outline[-1][0]), abs(p[1] - outline[-1][1])) > 0.05:
            outline.append(p)
    layers = sorted({r["LAYER"] for r in recs if r.get("RECORD") in ("Track", "Arc", "Via", "Pad")
                     and re.fullmatch(r"TOP|BOTTOM|MID\d+", r.get("LAYER", ""))})
    tracks = Counter(mm(r["WIDTH"]) for r in recs if r.get("RECORD") == "Track"
                     and re.fullmatch(r"TOP|BOTTOM|MID\d+", r.get("LAYER", "")))
    vias = Counter((mm(r["DIAMETER"]), mm(r["HOLESIZE"])) for r in recs if r.get("RECORD") == "Via")
    place = {}
    for r in recs:
        if r.get("RECORD") == "Component":
            x, y = flip(mm(r["X"]), mm(r["Y"]))
            place[r["SOURCEDESIGNATOR"]] = {"x": x, "y": y, "rot": float(r.get("ROTATION", 0)) % 360,
                                            "side": "bottom" if r.get("LAYER") == "BOTTOM" else "top"}
    return outline, layers, tracks, vias, place


def natural(ref):
    m = re.match(r"([A-Za-z]+)(\d*)", ref)
    return (m.group(1), int(m.group(2) or 0)) if m else (ref, 0)


def build_spec(src, pid, name):
    pcb = next(src.glob("*.pcbdoc"))
    sheets = sorted(src.glob("*/*.schdoc"))
    outline, layers, tracks, vias, place = board(pcb)

    groups = defaultdict(list)
    for c in schematic_parts(sheets):
        lcsc = c.get("Supplier Part") or c.get("SupplierPart") or None
        value = c.get("Value") or c.get("Comment") or ""
        fp = c.get("_footprint") or c.get("FootprintName")
        bom = (c.get("Add into BOM") or c.get("AddInBom") or "yes").lower() != "no"
        groups[(lcsc, value, fp, bom)].append(c)

    parts = []
    for (lcsc, value, fp, bom), cs in sorted(groups.items(), key=lambda g: min(natural(c.get("Designator", "")) for c in g[1])):
        first = cs[0]
        cls = first.get("JLCPCB Part Class", "")
        part = {
            "refs": sorted((c.get("Designator") for c in cs), key=natural),
            "value": value,
            "footprint": fp,
            "lcsc": lcsc,
            "mpn": first.get("Manufacturer Part") or first.get("ManufacturerPart") or None,
            "tier": "basic" if cls.startswith("Basic") else "extended" if cls.startswith("Extended") else None,
        }
        if not bom:
            part["assemble"] = False
            part["note"] = "not in BOM in EasyEDA (DNP)"
        parts.append(part)

    for i, p in enumerate(parts):
        p_id = re.sub(r"[^a-z0-9]+", "_", f"{p['refs'][0]}_{p['value']}".lower()).strip("_")
        parts[i] = {"id": p_id, **p}

    xs, ys = [p[0] for p in outline], [p[1] for p in outline]
    return {
        "spec_version": 0,
        "product": {"id": pid, "name": name, "lineage": f"EasyEDA Pro, Altium export of {src.name}"},
        "fab": {
            "house": "jlcpcb",
            "layers": len(layers),
            "assembly": "economic",
            "rules": {
                "track_widths_used": sorted(tracks),
                "vias_used": [{"diameter": d, "drill": h} for d, h in sorted(vias)],
            },
        },
        "board": {
            "size": [round(max(xs) - min(xs), 3), round(max(ys) - min(ys), 3)],
            "outline": {"type": "polygon", "points": outline},
        },
        "parts": parts,
        "placement": {"fixed": {ref: place[ref] for ref in sorted(place, key=natural)}},
    }


class FlowDumper(yaml.SafeDumper):
    pass


def _short_lists_inline(dumper, data):
    flow = all(not isinstance(x, (dict, list)) for x in data) or (data and all(isinstance(x, list) for x in data))
    return dumper.represent_sequence("tag:yaml.org,2002:seq", data, flow_style=flow)


def _small_dicts_inline(dumper, data):
    flow = len(data) <= 4 and all(not isinstance(v, (dict, list)) for v in data.values())
    return dumper.represent_mapping("tag:yaml.org,2002:map", data, flow_style=flow)


FlowDumper.add_representer(list, _short_lists_inline)
FlowDumper.add_representer(dict, _small_dicts_inline)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("src", type=Path)
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    spec = build_spec(args.src, args.id, args.name)
    text = yaml.dump(spec, Dumper=FlowDumper, sort_keys=False, allow_unicode=True, width=120)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
