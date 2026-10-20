#!/usr/bin/env python3
"""Validate a product.yaml and build the project KiCad library from its LCSC parts.

    fetch_parts.py <product.yaml>           validate, then run easyeda2kicad per part
    fetch_parts.py --check <product.yaml>   validate and summarize only (no network)

Output goes to hardware/libs/hyphi/ (hyphi.kicad_sym, hyphi.pretty/, hyphi.3dshapes/).
"""
import argparse
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

import yaml

LIB_DIR = Path(__file__).resolve().parent.parent / "libs" / "hyphi"
LCSC_RE = re.compile(r"^C\d+$")


def load(path):
    with open(path) as f:
        return yaml.safe_load(f)


def validate(spec):
    errors, warnings = [], []
    parts = spec.get("parts") or []
    ids = Counter(p.get("id") for p in parts)
    errors += [f"duplicate part id: {i}" for i, n in ids.items() if n > 1]
    refs = Counter(r for p in parts for r in p.get("refs") or [])
    errors += [f"ref used by more than one part: {r}" for r, n in refs.items() if n > 1]
    for p in parts:
        lcsc = p.get("lcsc")
        if p.get("assemble", True) and lcsc is None:
            warnings.append(f"{p.get('id')}: assembled part has no lcsc number yet")
        elif lcsc is not None and not LCSC_RE.match(str(lcsc)):
            errors.append(f"{p.get('id')}: bad lcsc number {lcsc!r}")
    return errors, warnings


def summarize(spec):
    parts = [p for p in spec.get("parts") or [] if p.get("assemble", True)]
    tiers = Counter(p.get("tier") or "unchecked" for p in parts)
    placements = sum(len(p.get("refs") or []) for p in parts)
    print(f"{spec['product']['name']} {spec['product'].get('revision', '')}")
    print(f"  assembled part types: {len(parts)}  placements: {placements}")
    print("  tiers: " + ", ".join(f"{k}={v}" for k, v in sorted(tiers.items())))
    if tiers.get("extended"):
        print(f"  extended setup fees: ~${3 * tiers['extended']} per order")
    print(f"  variants: {', '.join(spec.get('variants') or {}) or 'none'}")


def fetch(spec):
    if not shutil.which("easyeda2kicad"):
        sys.exit("easyeda2kicad not found: pip install easyeda2kicad")
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    failed = []
    for p in spec.get("parts") or []:
        lcsc = p.get("lcsc")
        if not lcsc:
            continue
        print(f"-> {p['id']} ({lcsc})")
        r = subprocess.run(
            ["easyeda2kicad", "--full", f"--lcsc_id={lcsc}",
             f"--output={LIB_DIR / 'hyphi'}", "--overwrite"],
        )
        if r.returncode != 0:
            failed.append(lcsc)
    if failed:
        sys.exit(f"failed: {', '.join(failed)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("spec")
    ap.add_argument("--check", action="store_true", help="validate and summarize only")
    args = ap.parse_args()

    spec = load(args.spec)
    errors, warnings = validate(spec)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if errors:
        print("spec errors:\n  " + "\n  ".join(errors), file=sys.stderr)
        sys.exit(1)
    summarize(spec)
    if not args.check:
        fetch(spec)


if __name__ == "__main__":
    main()
