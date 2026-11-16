"""Noms lisibles des articles du profil V3 : dictionnaires de traduction de Zwift (clés LOC_…).

Lit l'archive de localisation de l'installation Zwift locale (assets/Noesis/Blend_Data/noesis_loc.wad), décodée par
l'outil d'étude zwf_wad.py, et écrit <étude>/v3/loc/FR.json et EN.json ({clé LOC: texte}) que lit
apps/client/scripts/v3Assets.ts. Ressources Zwift : étude locale seulement, jamais distribuées.

Usage : python tools/v3_loc.py [installation Zwift] [dossier d'étude]
"""
import html
import json
import re
import sys
from pathlib import Path

zwift = Path(sys.argv[1] if len(sys.argv) > 1 else 'D:/Zwift')
study = Path(sys.argv[2] if len(sys.argv) > 2 else 'D:/zzCACHE_ALLEZROBERT/zwift-etude')
sys.path.insert(0, str(study / 'outils'))
import zwf_wad  # noqa: E402  (décodeur des archives .wad de l'étude)

data = zwf_wad.decode(str(zwift / 'assets/Noesis/Blend_Data/noesis_loc.wad'))
out = study / 'v3/loc'
out.mkdir(parents=True, exist_ok=True)
for path, offset, size, _flag in zwf_wad.entries(data):
    lang = path.rsplit('_', 1)[-1].split('.')[0]
    if lang not in ('FR', 'EN'):
        continue
    text = bytes(data[offset:offset + size]).decode('utf-8-sig')
    pairs = {html.unescape(key): html.unescape(value).strip()
             for key, value in re.findall(r'x:Key="(LOC_[^"]+)"[^>]*>([^<]*)<', text)}
    (out / (lang + '.json')).write_text(json.dumps(pairs, ensure_ascii=False), encoding='utf-8')
    print(lang, len(pairs), 'libellés')
