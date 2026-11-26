#!/usr/bin/env python3
"""Генератор лёгких GLB-моделей мебели для WebAR-каталога.

Собирает три модели (стул, стол, диван) из примитивов в реальном масштабе
в метрах и сохраняет их в assets/models/. Внешних зависимостей нет: GLB
собирается вручную из бинарных буферов (POSITION + indices) и PBR-материалов.

Запуск:  python3 scripts/generate_sample_models.py
"""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "assets" / "models"

OAK = (0.72, 0.53, 0.36)
FABRIC = (0.28, 0.36, 0.52)
METAL = (0.62, 0.63, 0.66)
CUSHION = (0.86, 0.82, 0.74)


def box(center, size):
    """Параллелепипед: 24 вершины (POSITION) и 36 индексов."""
    cx, cy, cz = center
    sx, sy, sz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    faces = [
        [(sx, -sy, -sz), (sx, sy, -sz), (sx, sy, sz), (sx, -sy, sz)],
        [(-sx, -sy, sz), (-sx, sy, sz), (-sx, sy, -sz), (-sx, -sy, -sz)],
        [(-sx, sy, -sz), (-sx, sy, sz), (sx, sy, sz), (sx, sy, -sz)],
        [(-sx, -sy, sz), (-sx, -sy, -sz), (sx, -sy, -sz), (sx, -sy, sz)],
        [(-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)],
        [(sx, -sy, -sz), (-sx, -sy, -sz), (-sx, sy, -sz), (sx, sy, -sz)],
    ]
    positions, indices = [], []
    for corners in faces:
        base = len(positions) // 3
        for x, y, z in corners:
            positions.extend((cx + x, cy + y, cz + z))
        indices.extend((base, base + 1, base + 2, base, base + 2, base + 3))
    return positions, indices


def cylinder(center, radius, height, segments=20):
    """Вертикальный цилиндр: боковая поверхность и две крышки."""
    cx, cy, cz = center
    half = height / 2.0
    positions, indices = [], []

    for i in range(segments):
        a0 = 2.0 * math.pi * i / segments
        a1 = 2.0 * math.pi * (i + 1) / segments
        x0, z0 = math.cos(a0), math.sin(a0)
        x1, z1 = math.cos(a1), math.sin(a1)
        base = len(positions) // 3
        for x, z in ((x0, z0), (x1, z1)):
            positions.extend((cx + x * radius, cy - half, cz + z * radius))
            positions.extend((cx + x * radius, cy + half, cz + z * radius))
        indices.extend(
            (
                base, base + 2, base + 3,
                base, base + 3, base + 1,
                base + 1, base + 3, base + 2,  # верхняя крышка
                base, base + 1, base + 2,      # нижняя крышка
            )
        )
    return positions, indices


def merge(primitives):
    """Несколько примитивов в одну часть с общим материалом."""
    positions, indices = [], []
    for prim_positions, prim_indices in primitives:
        base = len(positions) // 3
        positions.extend(prim_positions)
        indices.extend(index + base for index in prim_indices)
    return positions, indices


def material(name, base_color, roughness, metallic):
    return {
        "name": name,
        "pbrMetallicRoughness": {
            "baseColorFactor": list(base_color) + [1.0],
            "metallicFactor": metallic,
            "roughnessFactor": roughness,
        },
        "doubleSided": True,
    }


def build_glb(path, parts, materials):
    """parts: [(material_index, positions, indices), ...]; пишет валидный GLB 2.0."""
    buffer = bytearray()
    buffer_views, accessors, meshes = [], [], []

    for material_index, positions, indices in parts:
        xs, ys, zs = positions[0::3], positions[1::3], positions[2::3]

        offset = len(buffer)
        buffer.extend(struct.pack("<%df" % len(positions), *positions))
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": len(buffer) - offset,
                "target": 34962,
            }
        )
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5126,
                "count": len(positions) // 3,
                "type": "VEC3",
                "min": [min(xs), min(ys), min(zs)],
                "max": [max(xs), max(ys), max(zs)],
            }
        )
        position_accessor = len(accessors) - 1

        while len(buffer) % 4:
            buffer.append(0)

        offset = len(buffer)
        buffer.extend(struct.pack("<%dH" % len(indices), *indices))
        buffer_views.append(
            {
                "buffer": 0,
                "byteOffset": offset,
                "byteLength": len(buffer) - offset,
                "target": 34963,
            }
        )
        accessors.append(
            {
                "bufferView": len(buffer_views) - 1,
                "componentType": 5123,
                "count": len(indices),
                "type": "SCALAR",
            }
        )
        index_accessor = len(accessors) - 1

        while len(buffer) % 4:
            buffer.append(0)

        meshes.append(
            {
                "name": "part_%d" % len(meshes),
                "primitives": [
                    {
                        "attributes": {"POSITION": position_accessor},
                        "indices": index_accessor,
                        "material": material_index,
                        "mode": 4,
                    }
                ],
            }
        )

    gltf = {
        "asset": {"version": "2.0", "generator": "sample furniture generator"},
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": list(range(len(meshes)))}],
        "nodes": [{"name": "part_%d" % i, "mesh": i} for i in range(len(meshes))],
        "meshes": meshes,
        "materials": materials,
        "buffers": [{"byteLength": len(buffer)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    bin_chunk = bytes(buffer)
    while len(bin_chunk) % 4:
        bin_chunk += b"\x00"

    json_chunk = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    while len(json_chunk) % 4:
        json_chunk += b" "

    total = 12 + 8 + len(json_chunk) + 8 + len(bin_chunk)
    with open(path, "wb") as handle:
        handle.write(struct.pack("<III", 0x46546C67, 2, total))
        handle.write(struct.pack("<II", len(json_chunk), 0x4E4F534A))
        handle.write(json_chunk)
        handle.write(struct.pack("<II", len(bin_chunk), 0x004E4942))
        handle.write(bin_chunk)


def build_chair():
    legs = merge([cylinder((x, 0.22, y), 0.025, 0.44)
                  for x in (-0.20, 0.20) for y in (-0.20, 0.20)])
    seat = merge([box((0.0, 0.455, 0.0), (0.46, 0.05, 0.46)),
                  box((0.0, 0.72, -0.215), (0.44, 0.50, 0.06))])
    return [(0, *legs), (1, *seat)]


def build_table():
    top = merge([box((0.0, 0.735, 0.0), (1.20, 0.05, 0.70))])
    apron = merge([box((0.0, 0.695, 0.0), (1.06, 0.07, 0.56))])
    legs = merge([cylinder((x, 0.355, y), 0.030, 0.71)
                  for x in (-0.52, 0.52) for y in (-0.28, 0.28)])
    return [(0, *top), (1, *apron), (2, *legs)]


def build_sofa():
    body = merge([
        box((0.0, 0.20, 0.0), (1.90, 0.34, 0.88)),
        box((0.0, 0.56, -0.36), (1.90, 0.50, 0.16)),
        box((-0.90, 0.47, 0.0), (0.16, 0.26, 0.88)),
        box((0.90, 0.47, 0.0), (0.16, 0.26, 0.88)),
    ])
    cushions = merge([
        box((-0.42, 0.43, 0.04), (0.80, 0.16, 0.74)),
        box((0.42, 0.43, 0.04), (0.80, 0.16, 0.74)),
        box((-0.42, 0.62, -0.34), (0.74, 0.34, 0.14)),
        box((0.42, 0.62, -0.34), (0.74, 0.34, 0.14)),
    ])
    legs = merge([cylinder((x, 0.04, y), 0.028, 0.16)
                  for x in (-0.84, 0.84) for y in (-0.34, 0.34)])
    return [(1, *body), (3, *cushions), (2, *legs)]


MODELS = (
    (
        "chair.glb",
        build_chair,
        [
            material("ChairLegsMetal", METAL, 0.35, 0.9),
            material("ChairSeatFabric", FABRIC, 0.8, 0.0),
        ],
    ),
    (
        "table.glb",
        build_table,
        [
            material("TableTopOak", OAK, 0.55, 0.0),
            material("TableApronWood", (0.44, 0.30, 0.21), 0.6, 0.0),
            material("TableLegsMetal", METAL, 0.3, 0.95),
        ],
    ),
    (
        "sofa.glb",
        build_sofa,
        [
            material("SofaFrameFabric", FABRIC, 0.85, 0.0),
            material("SofaBodyFabric", (0.24, 0.31, 0.46), 0.9, 0.0),
            material("SofaLegsMetal", METAL, 0.35, 0.9),
            material("SofaCushion", CUSHION, 0.95, 0.0),
        ],
    ),
)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, builder, materials in MODELS:
        path = OUT_DIR / name
        build_glb(path, builder(), materials)
        print("%s: %.1f KB" % (path.relative_to(ROOT), path.stat().st_size / 1024.0))


if __name__ == "__main__":
    main()
