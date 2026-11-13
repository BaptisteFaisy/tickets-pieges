#!/usr/bin/env python3
"""Re-déclenche l'analyse de l'app sur les demandes déjà semées.

Pourquoi ce script existe : après un déploiement, les tickets semés portent
encore l'état calculé par la **version précédente**. `verify-demo-site.py` lit
cet état tel quel — on mesure donc l'ancien code et on croit à une régression.
Il faut provoquer une nouvelle analyse.

Le geste est volontairement le plus banal qui soit : **ajouter une étiquette**.
C'est une action utilisateur, donc `avi:jira:updated:issue` part, l'app relit le
ticket et réécrit la propriété `pieges`. Aucune écriture dans la propriété,
aucun raccourci : on passe par le même chemin qu'un humain.

Deux pièges, mesurés le 13 novembre 2026 :

  * l'endpoint `/rest/api/3/issue/{key}/labels` n'existe pas sur tous les
    tenants (404 « No endpoint ») — on passe par `PUT /rest/api/3/issue/{key}` ;
  * ce `PUT` **remplace** la liste d'étiquettes : on relit les étiquettes
    existantes et on ajoute le marqueur, sinon on efface le travail d'un autre
    (l'étiquette d'un exercice précédent, par exemple).

Usage :
    python3 scripts/retrigger-demo-site.py --site exemple.atlassian.net \
        --email moi@example.com [--lang fr] [--dry-run]

    # seulement quelques tickets (clés Jira, pas identifiants du jeu)
    python3 scripts/retrigger-demo-site.py --site … --email … --keys SECOPS-214,SECOPS-219

Sortie : les clés re-déclenchées, et le rappel d'attendre la file C3 (~30 s par
segment) avant de relancer `verify-demo-site.py`.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
TIMEOUT = 40
PAUSE = 0.5


def log(message: str) -> None:
    print(message, flush=True)


def call(
    site: str,
    method: str,
    path: str,
    auth: tuple[str, str],
    body: dict | None = None,
) -> tuple[int, object]:
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(f"https://{site}{path}", method=method, data=data)
    request.add_header("Accept", "application/json")
    credentials = base64.b64encode(f"{auth[0]}:{auth[1]}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {credentials}")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read().decode("utf-8")
            return response.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")[:200]
    except (urllib.error.URLError, TimeoutError) as error:
        return 0, {"error": str(error)[:200]}


def seeded_keys(language: str) -> list[str]:
    """Clés Jira des demandes semées pour cette langue (rapport de semis)."""
    path = RACINE / "out" / f"demo-seed-{language}.json"
    if not path.exists():
        raise SystemExit(
            f"{path} absent : semez d'abord (scripts/seed-demo-site.py) ou "
            "lancez verify-demo-site.py pour produire le rapport."
        )
    report = json.loads(path.read_text(encoding="utf-8"))
    return [row["issueKey"] for row in report.get("requests", []) if row.get("issueKey")]


def labels_of(site: str, key: str, auth: tuple[str, str]) -> list[str]:
    """Étiquettes actuelles du ticket (liste vide si illisible)."""
    code, payload = call(site, "GET", f"/rest/api/3/issue/{key}?fields=labels", auth)
    if code != 200 or not isinstance(payload, dict):
        return []
    fields = payload.get("fields")
    labels = fields.get("labels") if isinstance(fields, dict) else None
    return [label for label in labels or [] if isinstance(label, str)]


def retrigger_one(site: str, key: str, label: str, auth: tuple[str, str]) -> str | None:
    """Ajoute l'étiquette (en conservant les autres) ; rend la clé si réussi."""
    labels = labels_of(site, key, auth)
    if label in labels:
        return key
    code, payload = call(site, "PUT", f"/rest/api/3/issue/{key}", auth, {"fields": {"labels": labels + [label]}})
    if code in (200, 204):
        return key
    log(f"  {key} -> {code} {payload}")
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--site", required=True, help="site Atlassian (exemple.atlassian.net)")
    parser.add_argument("--email", required=True, help="courriel du compte qui re-déclenche")
    parser.add_argument("--token-file", default="~/.atlassian-api-token", help="fichier du jeton API")
    parser.add_argument("--lang", default="fr", choices=["fr", "en"], help="jeu dont on lit les clés")
    parser.add_argument("--keys", default="", help="clés Jira séparées par des virgules (défaut : tout le jeu)")
    parser.add_argument("--label", default="", help="étiquette de marquage (défaut : pieges-retrigger-<horodatage>)")
    parser.add_argument("--dry-run", action="store_true", help="liste les tickets, sans appel")
    options = parser.parse_args()

    keys = [key.strip() for key in options.keys.split(",") if key.strip()] or seeded_keys(options.lang)
    label = options.label or f"pieges-retrigger-{int(time.time())}"
    log(f"{len(keys)} demande(s) à re-déclencher — étiquette « {label} »")
    if options.dry_run:
        for key in keys:
            log(f"  {key}")
        return 0

    token_path = Path(options.token_file).expanduser()
    auth = (options.email, token_path.read_text(encoding="utf-8").strip())
    done = 0
    for key in keys:
        if retrigger_one(options.site, key, label, auth):
            done += 1
        time.sleep(PAUSE)
    log(f"{done}/{len(keys)} ticket(s) re-déclenché(s)")
    if done:
        log(
            "L'analyse reprend dans la file C3 (≈30 s par segment, plus le modèle). "
            "Attendez, puis lancez scripts/verify-demo-site.py."
        )
    return 0 if done == len(keys) else 1


if __name__ == "__main__":
    sys.exit(main())
