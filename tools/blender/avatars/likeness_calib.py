"""
Étalonnage de la ressemblance photo (docs/AVATARS.md § 11).

Entrée : repères MediaPipe bruts des rendus de face de l'avatar (tête de base, chaque curseur du
visage à ± 0,8, profils de base), produits par
    avatar-test.html?calib&raw   (journal de la page : RAW{...}RAW, à enregistrer en JSON)
Sortie : apps/client/src/onboarding/likenessCalib.json — repères retenus, forme de base (centrée,
normalisée, symétrisée), et variation de la forme par curseur (J) et par pose de la tête.

Le client (onboarding/likenessFit.ts) applique exactement la même chaîne (468 repères du visage
centrés, échelle quadratique moyenne, rotation de Procuste vers la forme de référence, symétrie,
un repère sur trois) puis résout une régression ridge bornée. Usage :
    python3 tools/blender/avatars/likeness_calib.py raw.json [sortie.json]
"""
import json
import sys

import numpy as np

STEP = 3      # un repère sur trois du maillage du visage (sans l'iris : 468 premiers)
LAMBDA = 3e-3
H = 0.8       # amplitude des rendus de calibrage
SUB = np.arange(0, 468, STEP)


def norm(X):
    X = X[:468].copy()
    X -= X.mean(0)
    return X / np.sqrt((X ** 2).sum(1).mean())


def align(X, ref):
    U, _, Vt = np.linalg.svd(X.T @ ref)
    D = np.eye(3)
    D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    return X @ (U @ D @ Vt)


def main():
    d = json.load(open(sys.argv[1]))
    out = sys.argv[2] if len(sys.argv) > 2 else 'apps/client/src/onboarding/likenessCalib.json'
    lm = {k: np.array(v, float).reshape(-1, 3) for k, v in d['lm'].items() if v}
    ids = [k[:-1] for k in lm if k.endswith('+') and ':' not in k]
    ref = norm(lm['base'])
    # Symétrie gauche / droite : chaque repère moyenné avec le miroir de son homologue (paires par
    # plus proche voisin du miroir de la forme de base, rendue de face). Les curseurs sont
    # symétriques ; la distorsion due au lacet d'une photo, elle, s'annule au premier ordre.
    pairs = np.array([np.argmin(((ref - m) ** 2).sum(1)) for m in ref * np.array([-1, 1, 1])])
    sym = lambda X: 0.5 * (X + X[pairs] * np.array([-1, 1, 1]))
    vec = lambda X: sym(align(norm(X), ref))[SUB].ravel()
    J = np.stack([(vec(lm[i + '+']) - vec(lm[i + '-'])) / (2 * H) for i in ids], 1)
    b = sym(ref)[SUB].ravel()
    # Colonnes de nuisance : pose de la tête (lacet ± 0,3 rad, tangage ± 0,2 rad), au premier et au
    # second ordre ; elles absorbent l'effet de l'angle de vue d'une photo, sans régularisation
    # forte, et ne sont pas rendues.
    poses = []
    for k, a in (('yaw', 0.3), ('pitch', 0.2)):
        p, m = vec(lm[f'pose:{k}+']), vec(lm[f'pose:{k}-'])
        poses += [(p - m) / (2 * a), (p + m - 2 * b) / (a * a)]
    P = np.stack(poses, 1)
    Jfull = np.concatenate([J, P], 1)
    reg = np.array([LAMBDA] * len(ids) + [LAMBDA * 1e-3] * P.shape[1])

    def fit(v):
        return np.clip(np.linalg.solve(Jfull.T @ Jfull + np.diag(reg), Jfull.T @ (v - b))[:len(ids)], -1, 1)
    # Contrôle sur les profils de base : cosinus entre curseurs retrouvés et vrais (traits ≥ 0,3).
    cosine = lambda x, tv, m: x[m] @ tv[m] / (np.linalg.norm(x[m]) * np.linalg.norm(tv[m]) + 1e-9)
    for pid, t in d.get('truths', {}).items():
        tv = np.array([t[i] for i in ids])
        m = np.abs(tv) >= 0.3
        line = f'{pid:8s} de face cos {cosine(fit(vec(lm["profile:" + pid])), tv, m):.2f}'
        if 'profileYaw:' + pid in lm:
            x = fit(vec(lm['profileYaw:' + pid]))
            line += f', de biais cos {cosine(x, tv, m):.2f} (saturés : {int((np.abs(x) >= 0.99).sum())})'
        print(line)
    cal = {
        'step': STEP, 'count': len(SUB), 'lambda': LAMBDA, 'sliders': ids,
        'ref': [round(float(v), 5) for v in ref.ravel()],
        'pairs': [int(i) for i in pairs],
        'base': [round(float(v), 5) for v in b],
        'jacobian': [[round(float(v), 5) for v in J[:, k]] for k in range(len(ids))],
        'pose': [[round(float(v), 5) for v in P[:, k]] for k in range(P.shape[1])],
    }
    json.dump(cal, open(out, 'w'), separators=(',', ':'))
    print('écrit', out)


if __name__ == '__main__':
    main()
