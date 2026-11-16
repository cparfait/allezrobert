"""Prépare les ressources du profil V3 dans un cache local."""
import argparse
import io
import json
from pathlib import Path
import struct
import sys
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image


def read_glb(path):
    data = path.read_bytes()
    tag, version, length, size = struct.unpack_from("<4sIII", data)
    if tag != b"glTF" or version != 2 or length != len(data):
        raise ValueError(f"GLB invalide : {path.name}")
    return json.loads(data[20:20 + size]), bytearray(data[28 + size:])


def write_glb(path, model, binary):
    binary.extend(bytes(-len(binary) % 4))
    model["buffers"][0]["byteLength"] = len(binary)
    header = json.dumps(model, ensure_ascii=True, separators=(",", ":")).encode()
    header += b" " * (-len(header) % 4)
    with path.open("wb") as output:
        output.write(struct.pack("<4sIIII", b"glTF", 2, 28 + len(header) + len(binary), len(header), 0x4E4F534A))
        output.write(header)
        output.write(struct.pack("<II", len(binary), 0x004E4942))
        output.write(binary)


def source_image(source, converter, work, hue=0):
    filename = Path(source)
    if filename.suffix.lower() in {".ztx", ".tgax"}:
        filename = work / "texture.dds"
        converter.write_dds(converter.read_tga(source), str(filename))
    with Image.open(filename) as original:
        image = original.convert("RGBA")
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    if hue:
        h, s, v = image.convert("RGB").convert("HSV").split()
        shift = round(hue * 256)
        h = h.point([(index + shift) % 256 for index in range(256)])
        rgb = Image.merge("HSV", (h, s, v)).convert("RGB")
        rgb.putalpha(image.getchannel("A"))
        return rgb
    return image


def texture_packer(model, binary, converter, work):
    cache = {}

    def pack(ref, direct=None, hue=0):
        source = direct or converter.resolve(ref)
        if not source:
            return None
        key = source, hue
        if key in cache:
            return cache[key]
        cache[key] = None
        try:
            image = source_image(source, converter, work, hue)
            encoded = io.BytesIO()
            image.save(encoded, "PNG", compress_level=2)
        except (OSError, ValueError, IndexError, struct.error):
            return None
        binary.extend(bytes(-len(binary) % 4))
        payload = encoded.getvalue()
        views = model.setdefault("bufferViews", [])
        images = model.setdefault("images", [])
        textures = model.setdefault("textures", [])
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(payload)})
        binary.extend(payload)
        images.append({"bufferView": len(views) - 1, "mimeType": "image/png"})
        textures.append({"source": len(images) - 1})
        cache[key] = len(textures) - 1
        return cache[key]

    return pack


def gear_catalogue(study, data, tools):
    import ztenues
    import ztex

    root = tools.parent / "xml-decoded"
    raw = study / "outils/wadsrc"
    manifest = json.loads((study / "tenues/manifest.json").read_text(encoding="utf-8-sig"))
    rows = json.loads((study / "tenues-catalogue.json").read_text(encoding="utf-8-sig"))
    skins = json.loads((study / "perso/corps/textures.json").read_text(encoding="utf-8-sig"))["peaux"]
    head_groups = {"caucasian": ("caucasien", 1), "asian": ("asiatique", 32), "african": ("africain", 36)}
    model_cache = {}

    def thumbnail(ref):
        source = ztex.resolve(ref)
        return source if source and Path(source).is_file() else None

    def model_source(ref):
        if not ref:
            return None
        if ref not in model_cache:
            filename = manifest.get("gde", {}).get(ztenues.key(ref))
            converted = study / "tenues/gde" / filename if filename else None
            model_cache[ref] = str(converted) if converted and converted.is_file() else ztenues.find(ref, [str(data), str(raw)])
        return model_cache[ref]

    for row in rows:
        options = []
        xml = ztenues.find(row["fiche"], [str(root), str(raw)])
        if xml:
            try:
                root_node = ET.parse(xml).getroot()
                options = [{field.tag: (field.text or "").strip() for field in option} for option in root_node.findall("ColorScheme")]
                row["thumbnail"] = thumbnail(root_node.findtext("Thumbnail"))
            except ET.ParseError:
                pass
        row["colors"] = options
        row["source"] = model_source(row.get("modele"))
        row["pairSource"] = model_source(row.get("modele_paire"))
        if row["type"] == "HEAD_TYPE":
            fields = row["nom"].lower().split()
            if len(fields) == 3 and fields[1] in head_groups and fields[2] in ("fair", "tan", "dark"):
                origin, row["geomgroup"] = head_groups[fields[1]]
                skin = skins["femme" if fields[0] == "female" else "homme"][origin]
                tone = ("fair", "tan", "dark").index(fields[2])
                row["texture"] = str(study / "perso/tex" / skin["teintes"][tone])
                row["normale"] = str(study / "perso/tex" / skin["normale"])
        row["thumbnail"] = row.get("thumbnail") or thumbnail(row.get("texture"))
        if not row["thumbnail"] and row.get("texture") and Path(row["texture"]).is_file():
            row["thumbnail"] = row["texture"]
        for option in options:
            option["preview"] = thumbnail(option.get("ThumbnailPath")) or thumbnail(option.get("TexturePath"))
    return rows


def main():
    parser = argparse.ArgumentParser()
    for field in ("tools", "study", "data", "source", "output"):
        parser.add_argument(field, type=Path)
    parser.add_argument("kind", choices=("bike", "object", "rider", "gear", "gear-catalogue", "map", "thumb"))
    parser.add_argument("variant", nargs="?", default=0, type=int)
    parser.add_argument("hue", nargs="?", default=None, type=float)
    args = parser.parse_args()
    sys.path.insert(0, str(args.tools))
    sys.dont_write_bytecode = True
    import ztex

    ztex.DATA = str(args.data)
    ztex.WADSRC = str(args.study / "outils/wadsrc")
    ztex.INDEX_CACHE = str(args.output.parent.parent / "texture-index.json")
    if not Path(ztex.INDEX_CACHE).is_file():
        supplied_index = args.tools / "ztex_index.json"
        if supplied_index.is_file():
            ztex._INDEX = json.loads(supplied_index.read_text(encoding="utf-8"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent) as temp:
        work = Path(temp)
        source = args.source
        gear_refs = {}
        if args.kind == "gear-catalogue":
            result = work / "gear.json"
            result.write_text(json.dumps(gear_catalogue(args.study, args.data, args.tools), ensure_ascii=False), encoding="utf-8")
            result.replace(args.output)
            return
        if args.kind in ("map", "thumb"):
            mapped = str(args.source) if args.source.is_file() else ztex.resolve(str(args.source))
            if not mapped:
                raise OSError(f"Texture source indisponible : {args.source}")
            output = work / "texture.png"
            image = source_image(mapped, ztex, work, args.hue or 0)
            if args.kind == "thumb":
                bounds = image.getchannel("A").getbbox()
                if bounds:
                    image = image.crop(bounds)
                image.thumbnail((192, 192), Image.Resampling.LANCZOS)
            image.save(output, "PNG", compress_level=2)
            output.replace(args.output)
            return
        if args.kind == "object" or (args.kind == "gear" and source.suffix.lower() == ".gde"):
            from zgde2glb import GLB, read_materials, skinned, static_part_meshes

            with source.open("rb") as model_file:
                version = struct.unpack_from("<H", model_file.read(6), 4)[0]
            converted = work / "object.glb"
            if args.kind == "gear" and version == 1:
                gear_refs = {m["shader"] or m["name"]: m["textures"] for m in read_materials(source.read_bytes())}
                skinned(str(source), str(converted), (0,))
            else:
                glb = GLB()
                levels, _ = static_part_meshes(glb, str(source), [args.variant], name=source.stem)
                glb.scene_nodes = [glb.node(name=source.stem, mesh=levels[args.variant][0])]
                glb.save(str(converted))
            source = converted
        if args.kind == "rider":
            folder = "Female" if source.stem == "FemaleMaster" else "Male"
            original = args.study / "outils/wadsrc/Humans" / folder / (source.stem + ".gde")
            if original.is_file():
                import zgde2glb as converter

                orient = converter.orient_and_normals

                def preserve_normals(positions, triangles, stored):
                    triangles, calculated = orient(positions, triangles, stored)
                    if stored is not None:
                        for index, normal in calculated.items():
                            candidate = stored[index]
                            if sum(a * b for a, b in zip(normal, candidate)) > 0:
                                calculated[index] = candidate
                    return triangles, calculated

                converter.orient_and_normals = preserve_normals
                source = work / "rider.glb"
                converter.skinned(str(original), str(source), (0, 2, 5))

        model, binary = read_glb(source)
        pack = texture_packer(model, binary, ztex, work)
        colourways = []
        if args.kind == "bike":
            colourways = json.loads(args.source.with_suffix(".json").read_text(encoding="utf-8")).get("coloris", [])
        selected = colourways[args.variant] if 0 <= args.variant < len(colourways) else {}
        can_shift = selected.get("HueShiftable", "").lower() == "true"
        hue = (args.hue if args.hue is not None else float(selected.get("HueOffset") or 0)) if can_shift else 0
        wardrobe = {}
        if args.kind == "rider":
            wardrobe = json.loads((args.study / "perso/corps/textures.json").read_text(encoding="utf-8-sig"))["corps"].get(args.source.stem, {})
        textured_materials = {
            primitive.get("material")
            for mesh in model.get("meshes", [])
            for primitive in mesh["primitives"]
            if "TEXCOORD_0" in primitive["attributes"]
        }
        for i, material in enumerate(model.get("materials", [])):
            if i not in textured_materials:
                continue
            refs = material.get("extras", {}).get("textures", gear_refs.get(material.get("name"), []))
            refs = [*refs, None, None][:2]
            paint = args.kind == "bike" and material.get("name") == "PAINT"
            body_refs = [*wardrobe.get(material.get("name"), []), None, None]
            body_dir = args.study / "perso/tex"
            diffuse = pack(selected.get("TexturePath"), hue=hue) if paint else None
            normal = pack(selected.get("NormalsPath")) if paint else None
            if diffuse is None:
                diffuse = pack(refs[0], str(body_dir / body_refs[0]) if body_refs[0] else None, hue if paint else 0)
            if normal is None:
                normal = pack(refs[1], str(body_dir / body_refs[1]) if body_refs[1] else None)
            if diffuse is not None:
                pbr = material.setdefault("pbrMetallicRoughness", {})
                pbr.update(baseColorFactor=[1, 1, 1, 1], baseColorTexture={"index": diffuse})
            if normal is not None:
                material["normalTexture"] = {"index": normal, "scale": 0.65}
        artifact = work / "output.glb"
        write_glb(artifact, model, binary)
        artifact.replace(args.output)
        print(json.dumps({"maps": len(model.get("images", [])), "materials": len(textured_materials)}))


if __name__ == "__main__":
    main()
