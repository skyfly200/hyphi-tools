#!/usr/bin/env python3
"""Check a .kicad_pcb against its product.yaml: outline size, layer count and placement.

    check_board.py <product.yaml> <board.kicad_pcb> [--tol 0.05]

Reads the board as text, so it needs no KiCad install and works on any KiCad
version's files. Exits 1 on any mismatch; positions are compared relative to
the Edge.Cuts bounding box, so the board can sit anywhere on the sheet.
"""
import argparse
import math
import re
import sys

import yaml


def top_level(text, tag):
    """Yield each top-level `(tag ...)` block, skipping parens inside strings."""
    i = 0
    while (i := text.find("\n\t(" + tag, i)) >= 0:
        depth, j = 0, i + 1
        while True:
            c = text[j]
            if c == '"':
                j += 1
                while text[j] != '"' or text[j - 1] == "\\":
                    j += 1
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        yield text[i + 1:j + 1]
        i = j


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("spec")
    ap.add_argument("board")
    ap.add_argument("--tol", type=float, default=0.05, help="position tolerance, mm")
    args = ap.parse_args()

    spec = yaml.safe_load(open(args.spec))
    text = open(args.board).read()
    problems = []

    edge = [(float(x), float(y)) for g in top_level(text, "gr_") if '"Edge.Cuts"' in g
            for x, y in re.findall(r"\((?:start|end|mid|xy) ([-\d.]+) ([-\d.]+)\)", g)]
    if not edge:
        sys.exit("board has no Edge.Cuts outline")
    x0, y0 = min(p[0] for p in edge), min(p[1] for p in edge)
    size = [round(max(p[0] for p in edge) - x0, 3), round(max(p[1] for p in edge) - y0, 3)]
    want = (spec.get("board") or {}).get("size")
    if want and any(abs(a - b) > args.tol for a, b in zip(size, want)):
        problems.append(f"outline {size} mm, spec says {want}")

    layers = len(re.findall(r'\(\d+ "(?:F|B|In\d+)\.Cu"', text))
    if spec.get("fab", {}).get("layers") not in (None, layers):
        problems.append(f"{layers} copper layers, spec says {spec['fab']['layers']}")

    place = (spec.get("placement") or {}).get("fixed") or {}
    seen = set()
    for fp in top_level(text, "footprint "):
        m = re.search(r'\(property "Reference" "([^"]+)"', fp)
        if not m:
            continue  # free pads, logos
        ref = m.group(1)
        seen.add(ref)
        if ref not in place:
            problems.append(f"{ref}: on the board but not in the spec")
            continue
        at = re.search(r"\n\t\t\(at ([-\d.]+) ([-\d.]+)(?: ([-\d.]+))?\)", fp)
        side = "bottom" if re.search(r'\n\t\t\(layer "B\.', fp) else "top"
        x, y, rot = float(at.group(1)) - x0, float(at.group(2)) - y0, float(at.group(3) or 0) % 360
        s = place[ref]
        if (math.hypot(x - s["x"], y - s["y"]) > args.tol or side != s.get("side", "top")
                or abs((rot - s.get("rot", 0) + 180) % 360 - 180) > 0.5):
            problems.append(f"{ref}: board ({x:.3f}, {y:.3f}) {rot:g}° {side}, "
                            f"spec ({s['x']}, {s['y']}) {s.get('rot', 0):g}° {s.get('side', 'top')}")
    problems += [f"{ref}: in the spec but not on the board" for ref in sorted(set(place) - seen)]

    print(f"{args.board}: {size[0]} x {size[1]} mm, {layers} layers, {len(seen)} placed parts")
    for p in problems:
        print("  " + p)
    print("OK" if not problems else f"{len(problems)} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
