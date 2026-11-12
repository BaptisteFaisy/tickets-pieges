#!/usr/bin/env python3
"""Vérifie le site de démonstration après le semis : la recette §23 jouée en vrai.

Pour chaque demande semée (`out/demo-seed-<lang>.json`), relit la propriété
indexée `pieges` **par REST** — ce que voit un humain dans l'interface — et la
compare à l'attendu du jeu d'essai (niveau de confiance, niveau de suspicion).

C'est la recette qui tourne sur un site réel : chaque ligne est une exigence de
la §23 confrontée à ce que l'app a réellement écrit, sans travail humain au
milieu. Sortie : un tableau sur la console et `out/demo-verify-<lang>.json`.

Usage :
    python3 scripts/verify-demo-site.py --site exemple.atlassian.net \
        --email moi@example.com --token-file ~/.atlassian-api-token [--lang fr]
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
TIMEOUT = 40


def log(message: str) -> None:
    print(message, flush=True)


def call(site: str, path: str, auth: tuple[str, str]) -> tuple[int, object]:
    request = urllib.request.Request(f"https://{site}{path}")
    request.add_header("Accept", "application/json")
    credentials = base64.b64encode(f"{auth[0]}:{auth[1]}".encode("utf-8")).decode("ascii")
    request.add_header("Authorization", f"Basic {credentials}")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            raw = response.read().decode("utf-8")
            return response.status, (json.loads(raw) if raw.strip() else None)
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, {"raw": raw[:200]}
    except (urllib.error.URLError, TimeoutError) as error:
        return 0, {"error": str(error)}


def read_property(site: str, issue_key: str, auth: tuple[str, str]) -> dict | None:
    code, payload = call(site, f"/rest/api/3/issue/{issue_key}/properties/pieges", auth)
    if code != 200 or not isinstance(payload, dict):
        return None
    value = payload.get("value")
    return value if isinstance(value, dict) else None


def issue_summary(site: str, issue_key: str, auth: tuple[str, str]) -> dict:
    code, payload = call(site, f"/rest/api/3/issue/{issue_key}?fields=labels,comment", auth)
    if code != 200 or not isinstance(payload, dict):
        return {"labels": [], "comments": 0}
    fields = payload.get("fields") or {}
    labels = fields.get("labels") or []
    comments = fields.get("comment") or {}
    return {"labels": labels, "comments": comments.get("total", 0)}


def expected_of(row: dict) -> tuple[str | None, str | None]:
    expected = row.get("expected")
    if not isinstance(expected, dict):
        return None, None
    return expected.get("trustLevel"), expected.get("suspicion")


def result_row(
    row: dict,
    issue_key: str,
    expected_trust: str | None,
    expected_suspicion: str | None,
    trust: str,
    suspicion: str,
    verdict: str,
    summary: dict,
) -> dict:
    """Une ligne du rapport de vérification."""
    return {
        "sampleId": row.get("sampleId"),
        "issueKey": issue_key,
        "expectedTrust": expected_trust,
        "gotTrust": trust,
        "expectedSuspicion": expected_suspicion,
        "gotSuspicion": suspicion,
        "verdict": verdict,
        "labels": summary["labels"],
        "comments": summary["comments"],
        "divergences": row.get("divergences", []),
    }


def verdict_of(
    value: dict | None,
    expected_trust: str | None,
    expected_suspicion: str | None,
    row: dict,
    summary: dict,
) -> tuple[str, str, str, str]:
    """Compare l'attendu du jeu et ce que le site porte vraiment."""
    if value is None:
        return "-", "-", "absente", "la propriete pieges n'a pas ete ecrite"
    trust = str(value.get("trustLevel", "-"))
    suspicion = str(value.get("suspicionLevel", "-"))
    mismatches = []
    if expected_trust and trust != expected_trust:
        mismatches.append("origine")
    if expected_suspicion and suspicion != expected_suspicion:
        mismatches.append("suspicion")
    verdict = "conforme" if not mismatches else ",".join(mismatches)
    note = ""
    if row.get("divergences"):
        note = "geste non reproductible : " + "; ".join(row["divergences"])[:64]
    if summary["labels"]:
        note = (note + " " if note else "") + "etiquettes: " + ",".join(summary["labels"][:3])
    return trust, suspicion, verdict, note


def verify(options: argparse.Namespace) -> int:
    auth = (options.email, Path(options.token_file).expanduser().read_text(encoding="utf-8").strip())
    seed_path = RACINE / options.seed
    if not seed_path.exists():
        log(f"rapport de semis introuvable : {seed_path} (lancer d'abord seed-demo-site.py)")
        return 1
    seed = json.loads(seed_path.read_text(encoding="utf-8"))
    rows = seed.get("requests", [])

    log(f"vérification de {len(rows)} demande(s) sur {options.site}")
    log(f"{'demande':<18} {'ticket':<13} {'origine':<16} {'suspicion':<16} {'ecart':<10} remarque")
    results = []
    for row in rows:
        issue_key = row.get("issueKey") or ""
        expected_trust, expected_suspicion = expected_of(row)
        value = read_property(options.site, issue_key, auth) if issue_key else None
        summary = issue_summary(options.site, issue_key, auth) if issue_key else {"labels": [], "comments": 0}
        trust, suspicion, verdict, note = verdict_of(value, expected_trust, expected_suspicion, row, summary)
        log(f"{row.get('sampleId', ''):<18} {issue_key:<13} {trust:<16} {suspicion:<16} {verdict:<10} {note[:70]}")
        results.append(result_row(row, issue_key, expected_trust, expected_suspicion, trust, suspicion, verdict, summary))

    conformes = sum(1 for row in results if row["verdict"] == "conforme")
    portees = sum(1 for row in results if row["verdict"] != "absente")
    log(f"\n{portees} demande(s) porte(nt) la propriete, {conformes} conforme(s) a l'attendu du jeu")
    out_path = RACINE / options.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(
            {
                "site": options.site,
                "total": len(results),
                "withProperty": portees,
                "conforming": conformes,
                "requests": results,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    log(f"rapport ecrit dans {options.out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Verifie le site de demo apres le semis.")
    parser.add_argument("--site", required=True)
    parser.add_argument("--email", required=True)
    parser.add_argument("--token-file", default="~/.atlassian-api-token")
    parser.add_argument("--lang", default="fr", choices=["fr", "en"])
    parser.add_argument("--seed", default="")
    parser.add_argument("--out", default="")
    options = parser.parse_args()
    if not options.seed:
        options.seed = f"out/demo-seed-{options.lang}.json"
    if not options.out:
        options.out = f"out/demo-verify-{options.lang}.json"
    return verify(options)


if __name__ == "__main__":
    sys.exit(main())
