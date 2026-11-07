#!/usr/bin/env python3
"""Generate simple icons (colored rounded square + letters) for every extension."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = {
    "01-ad-blocker": ("#dc2626", "S"),
    "02-tab-suspender": ("#7c3aed", "Zz"),
    "03-focus-blocker": ("#ea580c", "F"),
    "04-video-speed": ("#0891b2", "2x"),
    "05-youtube-cleaner": ("#e11d48", "YT"),
    "06-page-screenshot": ("#2563eb", "[ ]"),
    "07-site-css": ("#059669", "{}"),
    "08-dark-mode": ("#1f2937", "D"),
    "09-cookie-dismiss": ("#b45309", "C"),
    "10-read-later": ("#4f46e5", "R"),
    "11-screen-recorder": ("#dc2626", "●"),
    "12-tab-reasons": ("#0d9488", "?"),
    "13-word-learner": ("#9333ea", "Aa"),
    "14-copy-markdown": ("#334155", "M↓"),
}
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]


def font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def make(color, text, size):
    scale = 4  # draw big, then shrink = smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=color)
    fs = int(s * (0.62 if len(text) == 1 else 0.44 if len(text) == 2 else 0.34))
    f = font(fs)
    box = d.textbbox((0, 0), text, font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((s - w) / 2 - box[0], (s - h) / 2 - box[1]), text, font=f, fill="white")
    return img.resize((size, size), Image.LANCZOS)


for folder, (color, text) in ICONS.items():
    out = os.path.join(ROOT, "extensions", folder, "icons")
    os.makedirs(out, exist_ok=True)
    for size in (16, 32, 48, 128):
        make(color, text, size).save(os.path.join(out, f"{size}.png"))
print("icons written")
