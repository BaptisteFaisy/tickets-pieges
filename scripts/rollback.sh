#!/usr/bin/env bash
# Rollback : redéployer la version précédente de l'app Forge.
#
# Usage :
#   bash scripts/rollback.sh --help
#   bash scripts/rollback.sh --dry-run          # montre ce qu'il ferait
#   bash scripts/rollback.sh --tag v1.2.3       # redéploie une version taguée
#   bash scripts/rollback.sh                    # redéploie le tag précédent (auto)
#
# Le script ne devine pas : sans `--tag`, il prend le dernier tag git accessible
# depuis le commit précédent (`git describe`). Sans tag en dépôt, il refuse.
set -euo pipefail

usage() {
  awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "$0"
}

DRY_RUN=0
TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --tag) TAG="${2:-}"; shift 2 ;;
    *) echo "option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ -z "$TAG" ]; then
  TAG="$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)"
fi

if [ -z "$TAG" ]; then
  echo "Aucun tag précédent trouvé — passe --tag <version>." >&2
  exit 2
fi

echo "Version à redéployer : $TAG"
echo "Commit               : $(git rev-list -n1 "$TAG" 2>/dev/null || echo '(inconnu)')"

if [ "$DRY_RUN" = "1" ]; then
  echo "Simulation : la commande réelle serait :"
  echo "  forge deploy --non-interactive -e development -t $TAG"
  exit 0
fi

echo "Déploiement… (forge deploy -e development -t $TAG)"
if ! forge deploy --non-interactive -e development -t "$TAG"; then
  echo "Échec du rollback — l'ancienne version reste en place." >&2
  exit 1
fi
echo "Rollback terminé : $TAG est redéployé en développement."
echo "Pense à le propager en production : forge deploy --non-interactive -e production -t $TAG"
