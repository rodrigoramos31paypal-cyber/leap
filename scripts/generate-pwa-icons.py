#!/usr/bin/env python3
"""
Gerador de ícones PWA (Android + iOS) e splash screens iOS.

Fonte: public/images/logo.png (192x192, RGBA, hexágono LEAP em escuro
sobre transparência).

Saída: public/icons/
  • icon-192.png             ← Android (any) — fundo branco + logo preto
  • icon-512.png             ← Android (any)
  • icon-maskable-v2-192.png ← Android (maskable) — sangria total branca,
                                logo dentro da safe-zone interior (~75%)
  • icon-maskable-v2-512.png ← idem
  • apple-touch-120.png      ← iPhone @2x
  • apple-touch-152.png      ← iPad
  • apple-touch-167.png      ← iPad Pro
  • apple-touch-180.png      ← iPhone @3x
  • apple-touch.png          ← alias 180 (compatibilidade legacy)
  • splash-{ratio}.png       ← iOS startup images (5 dimensões)

Estratégia: o logo fonte já é escuro sobre transparência → compomos
directamente sobre canvas BG_LIGHT (branco). Para "any" mantém margem
visível; para maskable o logo cobre ~75% (resto = BG branco sangrado).
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "images" / "logo.png"
OUT = ROOT / "public" / "icons"

BG_LIGHT = (255, 255, 255, 255)   # branco — pedido do cliente

def load_logo_dark() -> Image.Image:
    """Lê o logo da fonte (já é escuro sobre transparência)."""
    return Image.open(SRC).convert("RGBA")

def composite(size: int, ratio: float, logo: Image.Image) -> Image.Image:
    """Canvas size x size com BG_LIGHT e logo preto centrado a `ratio`
    da largura."""
    canvas = Image.new("RGBA", (size, size), BG_LIGHT)
    target = int(size * ratio)
    resized = logo.resize((target, target), Image.LANCZOS)
    off = (size - target) // 2
    canvas.alpha_composite(resized, (off, off))
    return canvas

def save_rgb(img: Image.Image, path: Path) -> None:
    """Achata para RGB (sem alpha) sobre BG_LIGHT e grava."""
    bg = Image.new("RGB", img.size, BG_LIGHT[:3])
    bg.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
    bg.save(path, format="PNG", optimize=True)
    print(f"  • {path.relative_to(ROOT)}  ({img.size[0]}x{img.size[1]})")

def main():
    if not SRC.exists():
        raise SystemExit(f"Logo fonte não encontrado: {SRC}")
    OUT.mkdir(parents=True, exist_ok=True)
    logo = load_logo_dark()

    print("Android · purpose=any (margem ~22%, logo ~78%)")
    for size in (192, 512):
        save_rgb(composite(size, 0.78, logo), OUT / f"icon-{size}.png")

    print("Android · purpose=maskable (sangria total, safe-zone ~75%)")
    for size in (192, 512):
        # Logo dentro de 75% para sobreviver a qualquer máscara
        # (círculo, squircle, rounded-rect). Resto = BG sangrado.
        save_rgb(composite(size, 0.75, logo), OUT / f"icon-maskable-v2-{size}.png")

    print("iOS · apple-touch-icons (iOS aplica rounded-rect, logo ~80%)")
    for size in (120, 152, 167, 180):
        save_rgb(composite(size, 0.80, logo), OUT / f"apple-touch-{size}.png")
    # Alias legacy
    save_rgb(composite(180, 0.80, logo), OUT / "apple-touch.png")

    print("iOS · splash screens (fundo branco + logo centrado ~30%)")
    splashes = [
        (1242, 2688),  # iPhone 11 Pro Max / XS Max
        (1284, 2778),  # iPhone 14 Plus / 12 Pro Max
        (1170, 2532),  # iPhone 14 / 12 / 13
        (828, 1792),   # iPhone 11 / XR
        (750, 1334),   # iPhone SE 2nd/3rd gen
    ]
    for w, h in splashes:
        canvas = Image.new("RGBA", (w, h), BG_LIGHT)
        target = int(min(w, h) * 0.30)
        resized = logo.resize((target, target), Image.LANCZOS)
        canvas.alpha_composite(resized, ((w - target) // 2, (h - target) // 2))
        save_rgb(canvas, OUT / f"splash-{w}x{h}.png")

    print("\nFeito.")

if __name__ == "__main__":
    main()
