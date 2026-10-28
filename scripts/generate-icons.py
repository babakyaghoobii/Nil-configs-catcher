"""Optional icon maintenance helper. Requires Pillow; generated PNGs are committed."""
from pathlib import Path
from PIL import Image, ImageDraw

target = Path(__file__).resolve().parent.parent / "public" / "icons"
for filename, size, maskable in [("icon-192.png", 192, False), ("icon-512.png", 512, False), ("maskable-512.png", 512, True), ("apple-touch-icon.png", 180, False)]:
    scale = 4
    image = Image.new("RGB", (512 * scale, 512 * scale), "#ee7b45")
    drawing = ImageDraw.Draw(image)
    def points(values):
        return [((x * (0.77 if maskable else 1) + (59 if maskable else 0)) * scale, (y * (0.77 if maskable else 1) + (59 if maskable else 0)) * scale) for x, y in values]
    drawing.polygon(points([(126, 362), (170, 150), (224, 150), (301, 281), (328, 150), (385, 150), (340, 362), (288, 362), (210, 228), (182, 362)]), fill="white")
    drawing.polygon(points([(343, 78), (423, 78), (423, 158), (401, 158), (401, 115), (354, 162), (338, 146), (385, 100), (343, 100)]), fill="white")
    image.resize((size, size), Image.Resampling.LANCZOS).save(target / filename, optimize=True)
