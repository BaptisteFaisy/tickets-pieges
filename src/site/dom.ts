/**
 * Briques HTML du site — **une seule implémentation** de l'échappement et des
 * composants visuels, partagée par toutes les sections (`docs/SITE.md`).
 *
 * Règle : toute fonction qui reçoit du texte l'échappe. Les rares fonctions qui
 * assemblent du HTML déjà produit par une autre brique portent `Html` dans leur
 * nom — c'est le seul endroit où du markup entre sans être échappé.
 */

/** Échappement HTML : jamais de texte brut injecté dans la page. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Pastille de niveau ou d'état : la classe CSS vient d'une liste fermée. */
const TONES = new Set(['t0', 't1', 't2', 't3', 'clean', 'review', 'suspect', 'trapped', 'ok', 'warn', 'bad']);

export function badge(text: string, tone?: string): string {
  const safe = tone && TONES.has(tone) ? ` ${tone}` : '';
  return `<span class="badge${safe}">${esc(text)}</span>`;
}

/** Bloc de texte brut (sortie d'outil, JSON, texte encadré) : jamais interprété. */
export function pre(text: string): string {
  return `<pre>${esc(text)}</pre>`;
}

/** Code en ligne. */
export function code(text: string): string {
  return `<code>${esc(text)}</code>`;
}

/** Note secondaire (avertissement, limite, ce qui n'a pas été analysé). */
export function note(text: string): string {
  return `<p class="note">${esc(text)}</p>`;
}

/** Titre de bloc à l'intérieur d'une section. */
export function heading(text: string): string {
  return `<h4>${esc(text)}</h4>`;
}

/** Tableau : en-têtes et cellules sont échappés, sauf `cellHtml` explicite. */
export function table(headers: string[], rows: string[][], cellHtml = false): string {
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('');
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${cellHtml ? c : esc(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Liste à puces. */
export function list(items: string[], ordered = false): string {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</${tag}>`;
}

/** Paire clé/valeur en ligne. */
export function kv(pairs: [string, string][]): string {
  return `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}

/** Champ de formulaire : le libellé est échappé, le contrôle vient du caller. */
export function field(label: string, controlHtml: string): string {
  return `<label class="field"><span>${esc(label)}</span>${controlHtml}</label>`;
}

export function selectHtml(id: string, options: [string, string][], selected?: string): string {
  const items = options
    .map(([value, label]) => {
      const sel = value === selected ? ' selected' : '';
      return `<option value="${esc(value)}"${sel}>${esc(label)}</option>`;
    })
    .join('');
  return `<select id="${esc(id)}">${items}</select>`;
}

export function textareaHtml(id: string, rows: number, placeholder = '', value = ''): string {
  return `<textarea id="${esc(id)}" rows="${rows}" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
}

export function buttonHtml(id: string, label: string, kind: 'primary' | 'ghost' = 'primary'): string {
  const cls = kind === 'ghost' ? 'cta ghost' : 'cta';
  return `<button type="button" id="${esc(id)}" class="${cls}">${esc(label)}</button>`;
}

/** Bloc repliable : utile pour les sorties longues (JSON, configs générées). */
export function details(summary: string, bodyHtml: string, open = false): string {
  return `<details${open ? ' open' : ''}><summary>${esc(summary)}</summary>${bodyHtml}</details>`;
}

/** Encart de résultat d'une section. */
export function panel(bodyHtml: string, id?: string): string {
  return `<div class="panel"${id ? ` id="${esc(id)}"` : ''}>${bodyHtml}</div>`;
}

/** Grille à deux colonnes (formulaire / résultat). */
export function grid(leftHtml: string, rightHtml: string): string {
  return `<div class="demo-grid">${leftHtml}${rightHtml}</div>`;
}

/** Lecture d'un élément du DOM de la section ; `null` s'il est absent. */
export function byId<T extends HTMLElement>(root: HTMLElement | Document, id: string): T | null {
  return root.querySelector<T>(`#${CSS.escape(id)}`);
}

/** Valeur d'un champ texte ou d'une liste déroulante. */
export function valueOf(root: HTMLElement, id: string): string {
  const node = byId<HTMLInputElement>(root, id);
  return node ? node.value : '';
}
