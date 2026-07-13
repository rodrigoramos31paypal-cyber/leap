#!/usr/bin/env python3
"""
Gerador de ícones PWA (Android + iOS) e splash screens iOS.

Fonte: public/images/logo.png (192x192, RGBA, hexágono LEAP em escuro
sobre transparência).

Estratégia: composição IDÊNTICA em todos os ficheiros — fundo branco
sólido + logo escuro centrado a `LOGO_RATIO`. Garante que, depois de
qualquer máscara (iOS rounded-rect, Android circle/squircle/rounded-
rect/...), o conteúdo visível é igual em qualquer dispositivo.

Saída em public/icons/ — manifest.json e app/layout.tsx já referenciam
todos estes nomes.
"""
import base64, io
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "images" / "logo.png"
OUT = ROOT / "public" / "icons"

BG_LIGHT = (255, 255, 255, 255)
# Escala UNIFORME em todos os ícones. ≤80% respeita a safe-zone do
# maskable; deixa também margem confortável para o rounded-rect do iOS.
LOGO_RATIO = 0.72

def load_logo_dark() -> Image.Image:
    return Image.open(SRC).convert("RGBA")

def composite(size: int, ratio: float, logo: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), BG_LIGHT)
    target = int(size * ratio)
    resized = logo.resize((target, target), Image.LANCZOS)
    off = (size - target) // 2
    canvas.alpha_composite(resized, (off, off))
    return canvas

def save_rgb(img: Image.Image, path: Path) -> None:
    bg = Image.new("RGB", img.size, BG_LIGHT[:3])
    bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    bg.save(path, format="PNG", optimize=True)
    print(f"  - {path.relative_to(ROOT)}  ({img.size[0]}x{img.size[1]})")

def write_svg(path: Path, logo: Image.Image) -> None:
    """SVG 192x192 com mesma composição (fundo branco + logo embebido)."""
    buf = io.BytesIO()
    logo.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    inset = (1 - LOGO_RATIO) * 100 / 2
    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">\n'
        '  <rect width="192" height="192" fill="#ffffff"/>\n'
        f'  <image x="{inset:.2f}%" y="{inset:.2f}%" '
        f'width="{LOGO_RATIO*100:.2f}%" height="{LOGO_RATIO*100:.2f}%" '
        f'preserveAspectRatio="xMidYMid meet" '
        f'href="data:image/png;base64,{b64}"/>\n'
        '</svg>\n'
    )
    path.write_text(svg, encoding="utf-8")
    print(f"  - {path.relative_to(ROOT)}  (SVG)")

def main():
    if not SRC.exists():
        raise SystemExit(f"Logo nao encontrado: {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    logo = load_logo_dark()

    print(f"Escala uniforme: logo a {int(LOGO_RATIO*100)}% do canvas")

    print("Android (any)")
    for size in (192, 512):
        save_rgb(composite(size, LOGO_RATIO, logo), OUT / f"icon-{size}.png")

    print("Android (maskable)")
    for size in (192, 512):
        save_rgb(composite(size, LOGO_RATIO, logo), OUT / f"icon-maskable-v2-{size}.png")

    print("iOS apple-touch")
    for size in (120, 152, 167, 180):
        save_rgb(composite(size, LOGO_RATIO, logo), OUT / f"apple-touch-{size}.png")
    save_rgb(composite(180, LOGO_RATIO, logo), OUT / "apple-touch.png")

    print("Favicon")
    save_rgb(composite(32, LOGO_RATIO, logo), OUT / "favicon.png")
    save_rgb(composite(16, LOGO_RATIO, logo), OUT / "favicon-16.png")

    print("iOS splash (logo discreto, ~36% do lado menor)")
    splashes = [
        (1242, 2688), (1284, 2778), (1170, 2532),
        (828, 1792), (750, 1334),
    ]
    for w, h in splashes:
        canvas = Image.new("RGBA", (w, h), BG_LIGHT)
        target = int(min(w, h) * (LOGO_RATIO / 2))
        resized = logo.resize((target, target), Image.LANCZOS)
        canvas.alpha_composite(resized, ((w - target) // 2, (h - target) // 2))
        save_rgb(canvas, OUT / f"splash-{w}x{h}.png")

    print("SVG")
    write_svg(OUT / "icon.svg", logo)
    write_svg(OUT / "icon-maskable.svg", logo)

    print("\nFeito.")

if __name__ == "__main__":
    main()
