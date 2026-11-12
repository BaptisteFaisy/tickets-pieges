/**
 * Catalogue « réglages automatiques » (#18, #20, #89) — propriétaire : lot auto-reglages.
 *
 * Textes visibles des drapeaux fonctionnels, des mouvements de calibration
 * et du constat dédié « tentative de corrompre le détecteur ». Les deux
 * langues sont obligatoires (§21) ; `i18n.test.ts` vérifie qu'aucune clé ne manque.
 */
export const reglagesCatalog = {
  fr: {
    'reglages.title': 'Réglages automatiques',
    'reglages.flag.coupe-c3': 'couper la couche C3 (lecture par modèle) sur ce projet',
    'reglages.flag.force-report': 'forcer le mode report : rien ne change dans le portail',
    'reglages.flag.coupe-sas': 'désactiver le sas de sortie sur ce projet',
    'reglages.flag.mode-shadow': 'basculer en shadow : calculer sans agir',
    'reglages.tune.demote': 'règle {rule} rétrogradée d’un cran ({before} → {after}) : faux positifs répétés',
    'reglages.tune.promote': 'règle {rule} promue d’un cran ({before} → {after}) : règle précise',
    'reglages.tune.hold': 'règle {rule} inchangée : échantillon insuffisant ou précision intermédiaire',
    'reglages.security-alert': 'alerte sécurité : tentative de corrompre le détecteur',
    'reglages.tamper.benign-classifier': 'texte qui déclare l’analyseur bénin — tentative de corrompre le détecteur',
    'reglages.tamper.respond-safe': 'texte qui ordonne de répondre sain — tentative de corrompre le détecteur',
    'reglages.tamper.classify-safe': 'texte qui impose un verdict sain — tentative de corrompre le détecteur',
    'reglages.tamper.detector-off': 'texte qui déclare le détecteur désactivé — tentative de corrompre le détecteur',
    'reglages.tamper.rules-off': 'texte qui ordonne d’ignorer les règles d’analyse — tentative de corrompre le détecteur',
  },
  en: {
    'reglages.title': 'Automatic tuning',
    'reglages.flag.coupe-c3': 'disable layer C3 (model reading) on this project',
    'reglages.flag.force-report': 'force report mode: nothing changes in the portal',
    'reglages.flag.coupe-sas': 'disable the outbound gate on this project',
    'reglages.flag.mode-shadow': 'switch to shadow: compute without acting',
    'reglages.tune.demote': 'rule {rule} demoted one notch ({before} → {after}): repeated false positives',
    'reglages.tune.promote': 'rule {rule} promoted one notch ({before} → {after}): precise rule',
    'reglages.tune.hold': 'rule {rule} unchanged: insufficient sample or middling precision',
    'reglages.security-alert': 'security alert: attempt to corrupt the detector',
    'reglages.tamper.benign-classifier': 'text declaring the analyzer benign — attempt to corrupt the detector',
    'reglages.tamper.respond-safe': 'text ordering to answer safe — attempt to corrupt the detector',
    'reglages.tamper.classify-safe': 'text imposing a safe verdict — attempt to corrupt the detector',
    'reglages.tamper.detector-off': 'text declaring the detector disabled — attempt to corrupt the detector',
    'reglages.tamper.rules-off': 'text ordering to ignore analysis rules — attempt to corrupt the detector',
  },
};
