#!/usr/bin/env python3
"""Assemble /tmp/wb3gif frames into docs/screenshots/demo.gif."""
import json
from pathlib import Path
from PIL import Image

frames_meta = json.loads(Path('/tmp/wb3gif/frames.json').read_text())
TARGET_W = 880  # downscale for README weight

images, durations = [], []
for f in frames_meta:
    im = Image.open(f['file'])
    ratio = TARGET_W / im.width
    im = im.resize((TARGET_W, int(im.height * ratio)), Image.LANCZOS)
    im = im.convert('P', palette=Image.ADAPTIVE, colors=128)
    images.append(im)
    durations.append(max(f['ms'], 30))

out = Path('docs/screenshots/demo.gif')
images[0].save(out, save_all=True, append_images=images[1:],
               duration=durations, loop=0, optimize=True)
print(f'{out} — {len(images)} frames, {out.stat().st_size // 1024} KB')
