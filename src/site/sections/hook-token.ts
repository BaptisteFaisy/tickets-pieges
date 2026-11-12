/**
 * Bloc « cycle de vie du jeton » de la section Hook (§11) — émission, stockage
 * de la seule empreinte, vérifications (bon jeton, faux, absent, compte
 * inconnu), rotation et révocation de l'ancien jeton.
 *
 * Toute la mécanique vient de `src/hook/token.ts` ; ce fichier met en scène un
 * cycle complet et l'affiche en tableau : la colonne « réponse publique » montre
 * que les trois refus rendent exactement le même 401, la colonne « journal »
 * montre ce qui ne sort jamais de l'app.
 */

import { issueToken, rotateToken, verifyToken, type IssuedToken, type TokenCheck } from '../../hook/token';
import { buttonHtml, byId, esc, note, panel, table } from '../dom';
import type { SectionContext } from './types';
import { label, type CopyKey } from './hook-copy';

export type TokenStepKey =
  | 'issued'
  | 'correct'
  | 'wrong'
  | 'absent'
  | 'unknown'
  | 'rotated'
  | 'oldAfter'
  | 'newAfter';

const STEP_LABEL: Record<TokenStepKey, CopyKey> = {
  issued: 'tokenIssued',
  correct: 'tokenCorrect',
  wrong: 'tokenWrong',
  absent: 'tokenAbsent',
  unknown: 'tokenUnknown',
  rotated: 'tokenRotated',
  oldAfter: 'tokenOldAfter',
  newAfter: 'tokenNewAfter',
};

/** Une ligne du cycle : ce que le client voit, ce que le journal note. */
export interface TokenStep {
  key: TokenStepKey;
  /** Réponse publique : `200`, `401` — ou `—` quand aucune requête n'a lieu. */
  verdict: '200' | '401' | '—';
  /** Motif de journal (`reason` du domaine) : ne sort jamais dans la réponse. */
  log: TokenCheck['reason'] | 'issued' | 'rotated';
  detail: string;
}

export interface TokenCycleResult {
  issued: IssuedToken;
  rotated: IssuedToken;
  steps: TokenStep[];
}

function stepOf(key: TokenStepKey, check: TokenCheck | null, detail = ''): TokenStep {
  if (!check) return { key, verdict: '—', log: key === 'issued' ? 'issued' : 'rotated', detail };
  return { key, verdict: check.ok ? '200' : '401', log: check.reason, detail };
}

/** Empreinte affichée : les 16 premiers caractères suffisent à la démo. */
function shortHash(hash: string): string {
  return `${hash.slice(0, 16)}… (${hash.length} car.)`;
}

/** Joue un cycle complet : pur et déterministe si `generate` est fourni. */
export function tokenCycle(now: string, generate?: () => string): TokenCycleResult {
  const issued = issueToken('acct-demo', now, generate);
  const row = issued.row;
  const rotated = rotateToken(row, now, generate);
  const steps: TokenStep[] = [
    stepOf('issued', null, `${issued.token} → ${shortHash(row.tokenHash)}`),
    stepOf('correct', verifyToken(issued.token, row)),
    stepOf('wrong', verifyToken(`${issued.token}-faux`, row)),
    stepOf('absent', verifyToken(null, row)),
    stepOf('unknown', verifyToken(issued.token, null)),
    stepOf('rotated', null, `${rotated.token} → ${shortHash(rotated.row.tokenHash)}`),
    stepOf('oldAfter', verifyToken(issued.token, rotated.row)),
    stepOf('newAfter', verifyToken(rotated.token, rotated.row)),
  ];
  return { issued, rotated, steps };
}

/** Le tableau du cycle : étape, réponse publique, journal, détail. */
export function tokenResultHtml(result: TokenCycleResult, ctx: SectionContext): string {
  const headers = [
    label(ctx, 'tokenStep'),
    label(ctx, 'tokenPublic'),
    label(ctx, 'tokenLog'),
    label(ctx, 'tokenDetail'),
  ];
  const rows = result.steps.map((step) => [
    label(ctx, STEP_LABEL[step.key]),
    step.verdict,
    step.log,
    step.detail,
  ]);
  return table(headers, rows) + note(label(ctx, 'tokenNote'));
}

/** HTML du bloc : bouton « rejouer » et tableau du dernier cycle joué. */
export function renderToken(ctx: SectionContext): string {
  const result = tokenCycle(ctx.now);
  return `<div class="block"><h4>${esc(label(ctx, 'tokenTitle'))}</h4>` +
    buttonHtml('h-token-run', label(ctx, 'tokenRun'), 'ghost') +
    panel(tokenResultHtml(result, ctx), 'h-token-result') +
    '</div>';
}

/** Câblage : rejouer le cycle avec de nouveaux jetons aléatoires. */
export function mountToken(root: HTMLElement, ctx: SectionContext): void {
  byId<HTMLButtonElement>(root, 'h-token-run')?.addEventListener('click', () => {
    const target = byId<HTMLDivElement>(root, 'h-token-result');
    if (target) target.innerHTML = tokenResultHtml(tokenCycle(ctx.now), ctx);
  });
}
