#!/usr/bin/env python3
"""Regenerate the web's compressed board art from the archival originals in manila_assets/.

The originals stay untouched (T17); the browser only ever downloads these WebP derivatives.
Requires Pillow with WebP support:  python3 scripts/optimize-assets.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "manila_assets"
TARGET = ROOT / "apps" / "web" / "src" / "assets"

# (source file, output file, quality). Full resolution is kept: phones render the board at 3x DPR.
JOBS = [
    ("game_board.jpg", "game_board.webp", 80),
    ("nutmeg_shares.png", "nutmeg_shares.webp", 86),
    ("silk_shares.png", "silk_shares.webp", 86),
    ("jade_shares.png", "jade_shares.webp", 86),
    ("ginseng_shares.png", "ginseng_shares.webp", 86),
]


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    for source, output, quality in JOBS:
        image = Image.open(SOURCE / source)
        destination = TARGET / output
        image.save(destination, "WEBP", quality=quality, method=6)
        before = (SOURCE / source).stat().st_size // 1024
        after = destination.stat().st_size // 1024
        print(f"{source:>20} {before:>5} KB -> {output:<20} {after:>4} KB")


if __name__ == "__main__":
    main()
