"""Produit le masque de végétation Grand Paris (© Apur, IGN 2021, ODbL 1.0)."""

import gzip
import io
import struct
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
from PIL import Image


URL = "https://carto2.apur.org/apur/rest/services/OPENDATA/HAUTEUR_VEGETATION_2021/ImageServer/exportImage"
WEST, EAST = 636, 673
SOUTH, NORTH = 6837, 6882
RES = 128
OUTPUT = Path(__file__).resolve().parents[2] / "apps/client/public/geo/grand-paris-vegetation.bin.gz"


def strip(north, south):
    width, height = (EAST - WEST) * RES, (north - south) * RES
    query = urlencode({
        "bbox": f"{WEST*1000},{south*1000},{EAST*1000},{north*1000}",
        "bboxSR": 2154,
        "imageSR": 2154,
        "size": f"{width},{height}",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_NearestNeighbor",
        "renderingRule": '{"rasterFunction":"None"}',
        "f": "image",
    })
    with urlopen(f"{URL}?{query}", timeout=90) as response:
        with Image.open(io.BytesIO(response.read())) as image:
            if image.mode != "F" or image.size != (width, height):
                raise ValueError(f"Raster inattendu à {north} km nord : {image.mode}, {image.size}")
            values = np.asarray(image)
    valid = np.isfinite(values) & (values > 0)
    # La hauteur est codée en mètres, avec un décalage de 100 (public) ou 1000 (hors MGP).
    metres = np.where(values >= 1000, values - 1000, np.where(values >= 100, values - 100, values))
    classes = np.where(valid, np.where(metres < 1, 1, 2), 0).astype(np.uint8)
    # 2 bits par pixel, ouest vers est puis nord vers sud.
    packed = classes.reshape(-1, 4)
    print(f"{south}–{north} km nord, {np.count_nonzero(classes):,} pixels végétalisés", flush=True)
    return (packed[:, 0] | (packed[:, 1] << 2) | (packed[:, 2] << 4) | (packed[:, 3] << 6)).tobytes()


def main():
    strips = [(north, max(SOUTH, north - 6)) for north in range(NORTH, SOUTH, -6)]
    with ThreadPoolExecutor(max_workers=3) as pool:
        packed = list(pool.map(lambda bounds: strip(*bounds), strips))
    header = struct.pack("<4siiHHH", b"APV1", WEST, NORTH, EAST - WEST, NORTH - SOUTH, RES)
    data = gzip.compress(header + b"".join(packed), compresslevel=9, mtime=0)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(data)
    print(f"{OUTPUT.name}: {len(data):,} octets")


if __name__ == "__main__":
    main()
