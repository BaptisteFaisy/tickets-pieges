#!/usr/bin/env python3
"""Sème un site de démonstration avec le jeu d'essai intégré (TP-18, §25).

Le jeu d'essai (`data/sample/requests-*.json`, 19 familles en français et en
anglais) devient de **vraies demandes** sur un site Jira Service Management :
les déclencheurs de l'app se déclenchent pour de bon, l'origine est calculée sur
des faits réels (type de compte, organisation, canal) et la propriété indexée
`pieges` est écrite sur le ticket.

Ce qui est reproduit fidèlement, et ce qui ne peut pas l'être avec un seul jeton
(le script l'écrit dans son rapport, jamais en silence) :

| Cas du jeu | Geste réel | Fidélité |
|---|---|---|
| compte client du portail | `POST /rest/servicedeskapi/request` avec `raiseOnBehalfOf` | canal `portal`, auteur client : **exact** |
| agent interne (T3) | même appel **sans** `raiseOnBehalfOf` | auteur = compte Atlassian : **exact** |
| portail anonyme, courriel d'inconnu, compte d'app | impossible avec un jeton d'admin | demande créée en portail, **divergence signalée** |
| commentaire du client | commentaire posé par l'admin | auteur interne au lieu du client, **divergence signalée** |

Usage :
    python3 scripts/seed-demo-site.py --site exemple.atlassian.net \
        --email moi@example.com --token-file ~/.atlassian-api-token \
        --service-desk 11 --request-type 142 --customer <accountId> \
        --lang fr [--limit 5] [--only fr-04-invisibles] [--dry-run]

Sortie : `out/demo-seed-<lang>.json` (id du jeu → clé et identifiant du ticket,
geste employé, divergences). Relancer ne recrée pas ce qui existe déjà.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
TIMEOUT = 40

# Un canal que l'app sait reconnaître mais qu'un jeton d'admin ne peut pas produire.
CANAUX_NON_REPRODUCTIBLES = {"anonymousportal", "email", "API", "deployment"}


def log(message: str) -> None:
    print(message, flush=True)


def api(
    site: str,
    path: str,
    auth: tuple[str, str],
    body: dict | None = None,
    method: str | None = None,
) -> tuple[int, dict | list | None]:
    """Un appel REST : (code, json). Aucune exception ne sort, aucun secret n'est imprimé."""
    url = f"https://{site}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, method=method or ("POST" if body else "GET"))
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    credentials = base64_auth(auth)
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
            return error.code, {"raw": raw[:300]}
    except (urllib.error.URLError, TimeoutError) as error:
        return 0, {"error": str(error)}


def base64_auth(auth: tuple[str, str]) -> str:
    import base64

    return base64.b64encode(f"{auth[0]}:{auth[1]}".encode("utf-8")).decode("ascii")


def load_dataset(language: str) -> list[dict]:
    path = RACINE / "data" / "sample" / f"requests-{language}.json"
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise SystemExit(f"jeu d'essai illisible : {path}")
    return rows


def already_seeded(out_path: Path) -> dict[str, dict]:
    if not out_path.exists():
        return {}
    try:
        previous = json.loads(out_path.read_text(encoding="utf-8"))
        return {row["sampleId"]: row for row in previous.get("requests", [])}
    except (json.JSONDecodeError, KeyError):
        return {}


def create_request(sample: dict, options: argparse.Namespace, auth: tuple[str, str]) -> dict:
    """Crée la demande : via le portail client, ou en interne si l'auteur est un agent."""
    internal = sample.get("accountType") == "atlassian"
    fields = {"summary": sample["summary"], "description": sample["description"]}
    body = {
        "serviceDeskId": str(options.service_desk),
        "requestTypeId": str(options.request_type),
        "requestFieldValues": fields,
    }
    if not internal:
        body["raiseOnBehalfOf"] = options.customer
    code, payload = api(options.site, "/rest/servicedeskapi/request", auth, body)
    if code not in (200, 201) or not isinstance(payload, dict):
        return {"ok": False, "status": code, "detail": payload}
    return {
        "ok": True,
        "issueKey": payload.get("issueKey"),
        "issueId": payload.get("issueId"),
        "gesture": "jira-issue-interne" if internal else "portail-client",
    }


def add_comments(sample: dict, issue_key: str, options: argparse.Namespace, auth: tuple[str, str]) -> int:
    """Pose les commentaires du jeu d'essai (publics ou internes)."""
    added = 0
    for comment in sample.get("comments", []):
        body = {"body": comment.get("body", ""), "public": comment.get("visibility") != "internal"}
        code, _ = api(options.site, f"/rest/servicedeskapi/request/{issue_key}/comment", auth, body)
        if code in (200, 201):
            added += 1
        else:
            log(f"    commentaire refusé ({code}) sur {issue_key}")
        time.sleep(0.4)
    return added


def divergence(sample: dict) -> list[str]:
    """Ce que le site réel ne peut pas reproduire, dit explicitement (§21)."""
    notes = []
    channel = sample.get("channel")
    if channel in CANAUX_NON_REPRODUCTIBLES:
        notes.append(f"canal « {channel} » non reproductible avec un jeton d'admin : créé via le portail")
    if sample.get("accountType") == "app":
        notes.append("compte d'app non reproductible : créé par un compte humain")
    if any(c.get("author") == "customer" for c in sample.get("comments", [])):
        notes.append("commentaire client posé par l'admin : l'auteur réel diffère")
    return notes


def seed(options: argparse.Namespace) -> int:
    auth = (options.email, Path(options.token_file).expanduser().read_text(encoding="utf-8").strip())
    dataset = load_dataset(options.lang)
    if options.only:
        dataset = [row for row in dataset if row["id"] == options.only]
        if not dataset:
            raise SystemExit(f"demande introuvable dans le jeu : {options.only}")
    if options.limit:
        dataset = dataset[: options.limit]

    out_path = RACINE / options.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    done = already_seeded(out_path)

    code, me = api(options.site, "/rest/api/3/myself", auth)
    if code != 200:
        log(f"site injoignable ou jeton refusé (HTTP {code})")
        return 1
    log(f"site {options.site} · compte {(me or {}).get('displayName')} · {len(dataset)} demande(s) à semer")

    rows = list(done.values())
    for sample in dataset:
        sample_id = sample["id"]
        if sample_id in done:
            log(f"  = {sample_id} déjà semé ({done[sample_id].get('issueKey')})")
            continue
        if options.dry_run:
            log(f"  · {sample_id} → {sample['summary'][:52]}")
            continue
        created = create_request(sample, options, auth)
        if not created.get("ok"):
            log(f"  ! {sample_id} : création refusée ({created.get('status')}) {str(created.get('detail'))[:120]}")
            continue
        comments = add_comments(sample, created["issueKey"], options, auth)
        notes = divergence(sample)
        rows.append(
            {
                "sampleId": sample_id,
                "issueKey": created["issueKey"],
                "issueId": created["issueId"],
                "gesture": created["gesture"],
                "expected": sample.get("expected"),
                "comments": comments,
                "divergences": notes,
                "seededAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
        )
        log(f"  + {sample_id} → {created['issueKey']} ({created['gesture']}, {comments} commentaire(s))")
        time.sleep(0.8)

    payload = {
        "site": options.site,
        "serviceDeskId": options.service_desk,
        "requestTypeId": options.request_type,
        "language": options.lang,
        "requests": rows,
    }
    if not options.dry_run:
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"\n{len(rows)} demande(s) semée(s) — rapport écrit dans {options.out}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Sème un site de démo avec le jeu d'essai intégré.")
    parser.add_argument("--site", required=True, help="site Atlassian (exemple.atlassian.net)")
    parser.add_argument("--email", required=True, help="courriel du compte qui sème")
    parser.add_argument("--token-file", default="~/.atlassian-api-token", help="fichier contenant le jeton API")
    parser.add_argument("--service-desk", required=True, help="identifiant du service desk")
    parser.add_argument("--request-type", required=True, help="identifiant du type de demande")
    parser.add_argument("--customer", required=True, help="accountId du client pour raiseOnBehalfOf")
    parser.add_argument("--lang", default="fr", choices=["fr", "en"])
    parser.add_argument("--limit", type=int, default=0, help="ne semer que les N premières demandes")
    parser.add_argument("--only", default="", help="ne semer que cet identifiant du jeu")
    parser.add_argument("--out", default="", help="fichier de sortie (défaut : out/demo-seed-<lang>.json)")
    parser.add_argument("--dry-run", action="store_true", help="liste ce qui serait créé, sans appel")
    options = parser.parse_args()
    if not options.out:
        options.out = f"out/demo-seed-{options.lang}.json"
    return seed(options)


if __name__ == "__main__":
    sys.exit(main())
