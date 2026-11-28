#!/usr/bin/env python3
"""
Makes the still dithered pictures for openact.ing (public/images/art/*.png): the objects over the
"Built for" and Director sections. The moving globe, field and 404 are WebGL canvases in src/components/art/.

Each picture is a grid of square dots, made with ordered (Bayer) dithering.
The dots are light gray on a clear background. On the light theme, CSS inverts them
(the .dither class in src/styles/global.css), so one file works for both themes.

Run it from www/:  python3 scripts/make-art.py
It needs numpy and Pillow. The output is the same each time (fixed random seed).
"""
from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parent.parent / "public" / "images" / "art"
RNG = np.random.default_rng(7)

# An 8x8 Bayer matrix, as thresholds from 0 to 1.
B2 = np.array([[0, 2], [3, 1]])
B4 = np.block([[4 * B2, 4 * B2 + 2], [4 * B2 + 3, 4 * B2 + 1]])
B8 = np.block([[4 * B4, 4 * B4 + 2], [4 * B4 + 3, 4 * B4 + 1]])
BAYER = (B8 + 0.5) / 64.0


def noise2d(h, w, scale, seed_rng=RNG):
    """Smooth value noise, from 0 to 1."""
    gh, gw = int(h / scale) + 3, int(w / scale) + 3
    grid = seed_rng.random((gh, gw))
    ys = np.linspace(0, gh - 2.001, h)
    xs = np.linspace(0, gw - 2.001, w)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = grid[y0][:, x0]
    b = grid[y0][:, x0 + 1]
    c = grid[y0 + 1][:, x0]
    d = grid[y0 + 1][:, x0 + 1]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(h, w, scale, octaves=4):
    total, amp, norm = np.zeros((h, w)), 1.0, 0.0
    for i in range(octaves):
        total += amp * noise2d(h, w, max(scale / (2**i), 1.5))
        norm += amp
        amp *= 0.5
    return total / norm


def dither(lum, cell=4, dot=3, levels=(0.5, 0.75, 1.0)):
    """Turns a brightness map (0 to 1) into an RGBA image of square dots."""
    h, w = lum.shape
    lum = np.clip(lum, 0, 1)
    thr = np.tile(BAYER, (h // 8 + 1, w // 8 + 1))[:h, :w]
    on = lum > thr
    # Brighter areas get lighter dots.
    shade = np.select([lum < 0.33, lum < 0.66], [levels[0], levels[1]], levels[2])
    img = np.zeros((h * cell, w * cell, 4), dtype=np.uint8)
    ys, xs = np.nonzero(on)
    for y, x in zip(ys, xs):
        v = int(235 * shade[y, x])
        img[y * cell : y * cell + dot, x * cell : x * cell + dot] = (v, v, v, 255)
    return Image.fromarray(img, "RGBA")


def raymarch(sdf, w, h, cam_z=3.2, fov=1.1, light=(-0.5, -0.8, 0.6)):
    """A small ray marcher. Returns brightness (0 to 1) for an object made by sdf."""
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = (xx - w / 2) / h * fov
    v = (yy - h / 2) / h * fov
    ro = np.stack([np.zeros_like(u), np.zeros_like(u), np.full_like(u, cam_z)], -1)
    rd = np.stack([u, v, -np.ones_like(u)], -1)
    rd /= np.linalg.norm(rd, axis=-1, keepdims=True)
    t = np.zeros((h, w))
    hit = np.zeros((h, w), bool)
    for _ in range(160):
        p = ro + rd * t[..., None]
        d = sdf(p)
        hit |= d < 1e-3
        t = np.where(hit, t, t + d * 0.8)
    p = ro + rd * t[..., None]
    e = 1e-3
    n = np.stack(
        [
            sdf(p + [e, 0, 0]) - sdf(p - [e, 0, 0]),
            sdf(p + [0, e, 0]) - sdf(p - [0, e, 0]),
            sdf(p + [0, 0, e]) - sdf(p - [0, 0, e]),
        ],
        -1,
    )
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    L = np.array(light, float)
    L /= np.linalg.norm(L)
    diff = np.clip((n * L).sum(-1), 0, 1)
    rim = (1 - np.clip(-(n * rd).sum(-1), 0, 1)) ** 2
    lum = 0.12 + 0.7 * diff + 0.35 * rim
    return np.where(hit, lum, 0)


def rot(p, ax, ay):
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    ca, sa, cb, sb = np.cos(ax), np.sin(ax), np.cos(ay), np.sin(ay)
    y, z = y * ca - z * sa, y * sa + z * ca
    x, z = x * cb + z * sb, -x * sb + z * cb
    return np.stack([x, y, z], -1)


def sd_sphere(p):
    return np.linalg.norm(p, axis=-1) - 1.0


def sd_box(p, b=0.62):
    q = np.abs(p) - b
    return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(np.max(q, -1), 0) - 0.04


def sd_boxes(p):
    """A cube on its corner, for growing businesses."""
    return sd_box(rot(p, 0.62, 0.79), 0.62)


def sd_torus(p):
    q = rot(p, 1.05, 0.2)
    xz = np.sqrt(q[..., 0] ** 2 + q[..., 2] ** 2) - 0.9
    return np.sqrt(xz**2 + q[..., 1] ** 2) - 0.34


def sd_sheets(p):
    """Two sheets of paper, for Docs."""
    q = rot(p, 0.55, -0.55)
    a = sd_box_dims(q - [-0.12, 0, 0.1], (0.6, 0.8, 0.02))
    b = sd_box_dims(rot(q - [0.18, -0.05, -0.12], 0, 0.25), (0.6, 0.8, 0.02))
    return np.minimum(a, b)


def sd_box_dims(p, b):
    q = np.abs(p) - np.array(b)
    return np.linalg.norm(np.maximum(q, 0), axis=-1) + np.minimum(np.max(q, -1), 0) - 0.01


def sd_people(p):
    """Three spheres in a row, for Advisory: people side by side."""
    q = rot(p, 0.3, 0.0)
    s = [np.linalg.norm(q - [x, 0, z], axis=-1) - r for x, z, r in ((-0.95, -0.3, 0.42), (0, 0.15, 0.55), (0.95, -0.3, 0.42))]
    return np.minimum(np.minimum(s[0], s[1]), s[2])


def obj(sdf, name, w=120, h=90, **kw):
    lum = raymarch(sdf, w, h, **kw)
    dither(lum, cell=3, dot=2).save(OUT / f"{name}.png", optimize=True)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    obj(sd_sphere, "sphere", cam_z=2.9)
    obj(sd_boxes, "boxes", cam_z=3.1)
    obj(sd_torus, "ring", cam_z=2.9)
    obj(sd_sheets, "sheets", cam_z=1.9)
    obj(sd_people, "people", cam_z=2.6)
    for f in sorted(OUT.glob("*.png")):
        print(f.name, Image.open(f).size, f.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
