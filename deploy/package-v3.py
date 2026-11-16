"""Prépare le paquet de ressources privées du service V3, sans l’envoyer."""
import argparse
import io
import json
from pathlib import Path
import tarfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("data", "study", "conversion", "media", "clips", "output"):
        parser.add_argument(name, type=Path)
    args = parser.parse_args()
    study_paths = (
        "outils/wadsrc", "v3/velos", "v3/perso", "v3/loc", "animations/clips",
        "perso/corps", "perso/tex", "perso/casque.glb", "femmes/casque_zwift.glb",
        "tenues/manifest.json", "tenues/gde", "tenues-perso",
        "pieces-catalogue.json", "tenues-catalogue.json",
    )
    data_types = {".gde", ".ztx", ".tgax"}
    study_types = data_types | {".xml", ".json", ".png", ".jpg", ".glb", ".dds"}
    files = [(args.clips, "clips-garage.json")]

    def collect(root, subpath, destination, suffixes):
        source = root / subpath
        if not source.exists():
            raise FileNotFoundError(source)
        entries = [source] if source.is_file() else source.rglob("*")
        for file in entries:
            if file.is_file() and not file.is_symlink() and file.suffix.lower() in suffixes:
                files.append((file, f"{destination}/{file.relative_to(root).as_posix()}"))

    collect(args.data, ".", "data", data_types)
    for name in study_paths:
        collect(args.study, name, "study", study_types)
    collect(args.conversion, "xml-decoded", "convert", {".xml"})
    for name in ("ztex", "ztenues", "zgde2glb", "zgde"):
        collect(args.conversion, f"tools/{name}.py", "convert", {".py"})
    collect(args.media, "menu", "cache", {".jpg", ".mp4", ".webm"})
    collect(args.media, "studio/v6", "cache", {".png"})
    study_root = args.study.resolve().as_posix().rstrip("/") + "/"
    data_root = args.data.resolve().as_posix().rstrip("/") + "/"

    def relocate(value):
        if isinstance(value, dict):
            return {key: relocate(item) for key, item in value.items()}
        if isinstance(value, list):
            return [relocate(item) for item in value]
        if isinstance(value, str):
            path = value.replace("\\", "/")
            for root, target in ((study_root, "/sources/study/"), (data_root, "/sources/data/")):
                if path.casefold().startswith(root.casefold()):
                    return target + path[len(root):]
        return value

    total = sum(path.stat().st_size for path, _ in files)
    print(f"{len(files)} fichiers, {total / (1024**3):.2f} Gio avant compression", flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    partial = args.output.with_suffix(args.output.suffix + ".part")
    with tarfile.open(partial, "w:gz", compresslevel=1) as archive:
        for source, name in sorted(files, key=lambda item: item[1]):
            if name.startswith("study/") and source.suffix == ".json":
                data = json.loads(source.read_text(encoding="utf-8-sig"))
                payload = json.dumps(relocate(data), ensure_ascii=False, separators=(",", ":")).encode()
                entry = archive.gettarinfo(source, name)
                entry.size = len(payload)
                archive.addfile(entry, io.BytesIO(payload))
            else:
                archive.add(source, name, recursive=False)
    partial.replace(args.output)


if __name__ == "__main__":
    main()
