#!/usr/bin/env python3
"""Láminas de Gym-Exercise-Library -> imágenes ligeras propias de GymApp.

Complemento de tools/sync-exercise-library.mjs (córrelo después). Por cada
ejercicio del snapshot (src/exercise-library/generated/catalog.json) con
media.primary_image, lee la lámina original (PNG de ~2 MB) desde un
checkout LOCAL de la librería y escribe dos WebP:

  generated/media/<exercise_id>.webp        lámina completa, 800 px de ancho
  generated/media/<exercise_id>-mini.webp   franja de inicio/final, 320 px

y generated/media/index.json con los ids que tienen imagen. Igual que el
catálogo, el resultado se versiona en GymApp para que el despliegue no
necesite el repo de la librería. La librería nunca se modifica.

Uso: python3 tools/sync-exercise-media.py [--source ../Gym-Exercise-Library]
Requiere Pillow con soporte WebP.
"""
import argparse
import json
from pathlib import Path

from PIL import Image

RAIZ = Path(__file__).resolve().parent.parent
GENERADO = RAIZ / 'src' / 'exercise-library' / 'generated'
MEDIA = GENERADO / 'media'


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--source', default=str(RAIZ.parent / 'Gym-Exercise-Library'))
    fuente = Path(args.parse_args().source).resolve()

    catalogo = json.loads((GENERADO / 'catalog.json').read_text(encoding='utf-8'))
    MEDIA.mkdir(parents=True, exist_ok=True)
    con_imagen, faltantes = [], []
    for registro in catalogo:
        ruta = (registro.get('media') or {}).get('primary_image')
        if not isinstance(ruta, str):
            continue
        original = fuente / ruta.lstrip('/')
        if not original.is_file():
            faltantes.append(registro['exercise_id'])
            continue
        ej = registro['exercise_id']
        img = Image.open(original).convert('RGB')
        w, h = img.size
        img.resize((800, round(800 * h / w)), Image.LANCZOS).save(MEDIA / f'{ej}.webp', 'WEBP', quality=72, method=6)
        # Las láminas traen arriba el título y abajo músculos/técnica; la
        # miniatura toma solo la franja de las fotos de inicio y final.
        franja = img.crop((0, round(h * 0.10), w, round(h * 0.56)))
        franja.resize((320, round(320 * franja.size[1] / w)), Image.LANCZOS).save(MEDIA / f'{ej}-mini.webp', 'WEBP', quality=70, method=6)
        con_imagen.append(ej)

    # Borra imágenes de ejercicios que ya no tienen lámina en el snapshot.
    vigentes = {f'{e}.webp' for e in con_imagen} | {f'{e}-mini.webp' for e in con_imagen}
    for archivo in MEDIA.glob('*.webp'):
        if archivo.name not in vigentes:
            archivo.unlink()

    (MEDIA / 'index.json').write_text(json.dumps({'ids': sorted(con_imagen)}, indent=1) + '\n', encoding='utf-8')
    print(f'{len(con_imagen)} láminas escritas; {len(faltantes)} referencias sin archivo en la fuente.')


if __name__ == '__main__':
    main()
