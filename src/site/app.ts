/**
 * Ossature du site de démonstration : navigation entre les features, langue,
 * stockage de session, rendu des sections.
 *
 * L'ossature ne contient **aucune règle du produit** : elle monte les sections
 * déclarées dans `src/site/sections/registry.ts`. Chaque section appelle le
 * domaine fusionné et rend son résultat — ajouter une feature au site, c'est
 * ajouter un fichier de section et une ligne au registre.
 */

import { t as translate, missingKeys } from '../core/i18n';
import type { Language } from '../core/types';
import { createMemoryStore } from '../platform/memory';
import { SECTIONS } from './sections/registry';
import type { Section, SectionContext } from './sections/types';

/** Injecté par esbuild à la construction (`tools/build-site.mjs`). */
declare const __BUILD__: string;

/** Instant fixe : le site ne lit jamais l'heure du système dans le domaine. */
const NOW = '2026-11-11T12:00:00.000Z';

const store = createMemoryStore();
let lang: Language = 'en';
let activeId = SECTIONS[0]?.id ?? '';

/** Contexte partagé, reconstruit à chaque changement de langue. */
function context(): SectionContext {
  return {
    lang,
    t: (key, vars) => translate(lang, key, vars),
    store,
    now: NOW,
    notify,
  };
}

/** Message court au visiteur (aucune donnée du produit n'y transite). */
function notify(message: string): void {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.classList.add('show');
  window.setTimeout(() => node.classList.remove('show'), 4000);
}

/** Textes statiques de la page : `data-en` / `data-fr`. */
function applyStaticTexts(): void {
  document.documentElement.setAttribute('lang', lang);
  for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-en][data-fr]'))) {
    const text = node.getAttribute(`data-${lang}`);
    if (text !== null && node.children.length === 0) node.textContent = text;
  }
  const button = document.getElementById('lang');
  if (button) {
    button.textContent = lang === 'en' ? 'FR' : 'EN';
    button.setAttribute('aria-label', lang === 'en' ? 'Français' : 'English');
  }
}

/** Barre d'onglets : une entrée par section du registre. */
function renderNav(): void {
  const nav = document.getElementById('features-nav');
  if (!nav) return;
  nav.innerHTML = SECTIONS.map((section) => {
    const current = section.id === activeId ? ' class="current"' : '';
    return `<button type="button" data-section="${section.id}"${current}>${escapeText(section.titles[lang])}</button>`;
  }).join('');
  for (const button of Array.from(nav.querySelectorAll<HTMLButtonElement>('button[data-section]'))) {
    button.addEventListener('click', () => {
      const id = button.getAttribute('data-section');
      if (id) void show(id);
    });
  }
}

/** Échappement minimal pour les titres d'onglet (le reste passe par `src/site/dom.ts`). */
function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Rend la section active, puis câble ses interactions. */
async function render(section: Section): Promise<void> {
  const host = document.getElementById('feature');
  if (!host) return;
  host.innerHTML = `<p class="empty">${lang === 'fr' ? 'Chargement…' : 'Loading…'}</p>`;
  try {
    const html = await section.render(context());
    host.innerHTML = html;
    section.mount?.(host, context());
  } catch (error) {
    host.innerHTML = `<p class="note">${escapeText(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

/** Affiche une section (et reflète l'ancre dans l'URL). */
export async function show(id: string): Promise<void> {
  const section = SECTIONS.find((item) => item.id === id) ?? SECTIONS[0];
  if (!section) return;
  activeId = section.id;
  if (window.location.hash !== `#${section.id}`) {
    window.history.replaceState(null, '', `#${section.id}`);
  }
  renderNav();
  await render(section);
}

/** Change de langue : textes statiques, onglets et section active. */
export async function toggleLanguage(): Promise<void> {
  lang = lang === 'en' ? 'fr' : 'en';
  applyStaticTexts();
  await show(activeId);
}

/** Démarrage : langue, onglets, ancre demandée, pied de page. */
async function start(): Promise<void> {
  applyStaticTexts();
  const build = document.getElementById('build');
  if (build) build.textContent = `${__BUILD__} · ${SECTIONS.length} sections`;
  const languageButton = document.getElementById('lang');
  if (languageButton) languageButton.addEventListener('click', () => void toggleLanguage());
  const hash = window.location.hash.replace('#', '');
  await show(SECTIONS.some((section) => section.id === hash) ? hash : activeId);
  // Contrôle interne : les deux langues doivent porter exactement les mêmes clés.
  const missing = missingKeys();
  if (missing.fr.length + missing.en.length > 0) notify(`i18n: ${missing.fr.length + missing.en.length} clé(s) manquante(s)`);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void start());
  else void start();
}
