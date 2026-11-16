"""Lisse les normales d'un GLB converti de Zwift : les sommets confondus dont les normales font moins de `angle` degrés
reçoivent leur normale moyenne (facettes supprimées), les vraies arêtes (au-delà) restent vives.
Usage : python tools/v3_smooth_glb.py <entrée.glb> <sortie.glb> [angle=50]
Sert aux casques par défaut du style V3, livrés tout faits par l'étude (sans normales stockées à reprendre)."""
import collections
import json
import math
import struct
import sys
from pathlib import Path


def smooth(source: Path, target: Path, angle: float = 50.0) -> tuple[int, int]:
    data = bytearray(source.read_bytes())
    length = struct.unpack_from('<I', data, 12)[0]
    model = json.loads(data[20:20 + length])
    start = 20 + length + 8
    limit = math.cos(math.radians(angle))
    changed = total = 0

    def view(index):
        accessor = model['accessors'][index]
        buffer_view = model['bufferViews'][accessor['bufferView']]
        offset = start + buffer_view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        stride = buffer_view.get('byteStride', 12)
        return offset, stride, accessor['count']

    for mesh in model.get('meshes', []):
        for primitive in mesh['primitives']:
            attributes = primitive['attributes']
            if 'POSITION' not in attributes or 'NORMAL' not in attributes:
                continue
            p_off, p_stride, count = view(attributes['POSITION'])
            n_off, n_stride, _ = view(attributes['NORMAL'])
            positions = [struct.unpack_from('<3f', data, p_off + i * p_stride) for i in range(count)]
            normals = [struct.unpack_from('<3f', data, n_off + i * n_stride) for i in range(count)]
            groups = collections.defaultdict(list)
            for i, p in enumerate(positions):
                groups[(round(p[0], 5), round(p[1], 5), round(p[2], 5))].append(i)
            for members in groups.values():
                if len(members) < 2:
                    continue
                for i in members:
                    near = [normals[j] for j in members if sum(a * b for a, b in zip(normals[i], normals[j])) >= limit]
                    x, y, z = (sum(n[k] for n in near) for k in range(3))
                    size = math.sqrt(x * x + y * y + z * z) or 1.0
                    new = (x / size, y / size, z / size)
                    total += 1
                    if sum(a * b for a, b in zip(new, normals[i])) < 0.9999:
                        changed += 1
                    struct.pack_into('<3f', data, n_off + i * n_stride, *new)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(bytes(data))
    return changed, total


if __name__ == '__main__':
    done, seen = smooth(Path(sys.argv[1]), Path(sys.argv[2]), float(sys.argv[3]) if len(sys.argv) > 3 else 50.0)
    print(json.dumps({'normales_modifiees': done, 'sommets_partages': seen}))
