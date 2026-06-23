#!/usr/bin/env python3
"""
Gerador de ícones PWA (Android + iOS) e splash screens iOS.

Fonte: public/images/logo.png (192x192, RGBA, hexágono LEAP em escuro
sobre transparência).

Saída: public/icons/
  • icon-192.png             ← Android (any) — fundo dark + logo branco
  • icon-512.png             ← Android (any)
  • icon-maskable-v2-192.png ← Android (maskable) — sangria total, logo
                                dentro da safe-zone interior (~75%)
  • icon-maskable-v2-512.png ← idem
  • apple-touch-120.png      ← iPhone @2x
  • apple-touch-152.png      ← iPad
  • apple-touch-167.png      ← iPad Pro
  • apple-touch-180.png      ← iPhone @3x
  • apple-touch.png          ← alias 180 (compatibilidade legacy)
  • splash-{ratio}.png       ← iOS startup images (5 dimensões)

Estratégia: inverter o RGB do logo (mantendo alpha) para o logo passar
de escuro→claro. Composição sobre canvas BG_DARK. Para "any" mantém
margens visíveis; para maskable o logo cobre ~75% do canvas (resto = BG).
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "images" / "logo.png"
OUT = ROOT / "public" / "icons"

BG_DARK = (10, 10, 10, 255)   # #0A0A0A, igual ao theme/manifest

def load_logo_white() -> Image.Image:
    """Lê o logo (escuro) e devolve uma versão BRANCA (RGB invertido,
    alpha preservado) sobre transparência."""
    src = Image.open(SRC).convert("RGBA")
    r, g, b, a = src.split()
    # Inverter RGB → o desenho fica branco sem mexer no contorno.
    white = Image.merge("RGBA", (
        r.point(lambda v: 255 - v),
        g.point(lambda v: 255 - v),
        b.point(lambda v: 255 - v),
        a,
    ))
    return white

def composite(size: int, ratio: float, logo_white: Image.Image) -> Image.Image:
    """Canvas size x size com BG_DARK e logo branco centrado a `ratio`
    da largura."""
    canvas = Image.new("RGBA", (size, size), BG_DARK)
    target = int(size * ratio)
    logo = logo_white.resize((target, target), Image.LANCZOS)
    off = (size - target) // 2
    canvas.alpha_composite(logo, (off, off))
    return canvas

def save_rgb(img: Image.Image, path: Path) -> None:
    """Achata para RGB (sem alpha) sobre BG_DARK e grava."""
    bg = Image.new("RGB", img.size, BG_DARK[:3])
    bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    bg.save(path, format="PNG", optimize=True)
    print(f"  • {path.relative_to(ROOT)}  ({img.size[0]}x{img.size[1]})")

def main():
    if not SRC.exists():
        raise SystemExit(f"Logo fonte não encontrado: {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    logo_white = load_logo_white()

    print("Android · purpose=any (margem ~22%, logo ~78%)")
    for size in (192, 512):
        save_rgb(composite(size, 0.78, logo_white), OUT / f"icon-{size}.png")

    print("Android · purpose=maskable (sangria total, safe-zone ~75%)")
    for size in (192, 512):
        # Logo dentro de 75% para sobreviver a qualquer máscara
        # (círculo, squircle, rounded-rect). Resto = BG sangrado.
        save_rgb(composite(size, 0.75, logo_white), OUT / f"icon-maskable-v2-{size}.png")

    print("iOS · apple-touch-icons (iOS aplica rounded-rect, logo ~80%)")
    for size in (120, 152, 167, 180):
        save_rgb(composite(size, 0.80, logo_white), OUT / f"apple-touch-{size}.png")
    # Alias legacy
    save_rgb(composite(180, 0.80, logo_white), OUT / "apple-touch.png")

    print("iOS · splash screens (fundo dark + logo centrado ~30%)")
    splashes = [
        (1242, 2688),  # iPhone 11 Pro Max / XS Max
        (1284, 2778),  # iPhone 14 Plus / 12 Pro Max
        (1170, 2532),  # iPhone 14 / 12 / 13
        (828, 1792),   # iPhone 11 / XR
        (750, 1334),   # iPhone SE 2nd/3rd gen
    ]
    for w, h in splashes:
        canvas = Image.new("RGBA", (w, h), BG_DARK)
        target = int(min(w, h) * 0.30)
        logo = logo_white.resize((target, target), Image.LANCZOS)
        canvas.alpha_composite(logo, ((w - target) // 2, (h - target) // 2))
        save_rgb(canvas, OUT / f"splash-{w}x{h}.png")

    print("\nFeito.")

if __name__ == "__main__":
    main()
