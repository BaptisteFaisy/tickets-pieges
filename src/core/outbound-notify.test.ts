import { describe, expect, it } from 'vitest';
import {
  checkInternalCopy,
  checkNotification,
  measureNotifyWindow,
  notifyWindowAnnouncement,
} from './outbound-notify';
import type { OutboundContext } from './types';

const context: OutboundContext = {
  issueKey: 'TP-1',
  requestText: 'Je veux le statut de ma commande.',
  otherIssueKeys: ['TP-2'],
  strict: true,
  taintedSession: false,
};

describe('fenêtre du courriel de notification (#31)', () => {
  it('mesure la fenêtre entre commentaire public et contrôle', () => {
    const window = measureNotifyWindow('2026-11-12T09:00:00.000Z', '2026-11-12T09:00:45.000Z');
    expect(window.measured).toBe(true);
    expect(window.delayMs).toBe(45_000);
    expect(window.withinTarget).toBe(true);
    expect(window.notificationMayHaveLeft).toBe(true);
  });

  it('annonce la fenêtre mesurée, en français et en anglais', () => {
    const window = measureNotifyWindow('2026-11-12T09:00:00.000Z', '2026-11-12T09:00:45.000Z');
    expect(notifyWindowAnnouncement(window, 'fr')).toContain('45');
    expect(notifyWindowAnnouncement(window, 'en')).toContain('45');
  });

  it('dit clairement quand la fenêtre n’est pas mesurable', () => {
    const window = measureNotifyWindow('pas-une-date', '2026-11-12T09:00:45.000Z');
    expect(window.measured).toBe(false);
    expect(window.notificationMayHaveLeft).toBe(true);
    expect(notifyWindowAnnouncement(window, 'fr')).toContain('non mesurable');
  });

  it('n’accuse pas la notification quand le contrôle précède le commentaire', () => {
    const window = measureNotifyWindow('2026-11-12T09:01:00.000Z', '2026-11-12T09:00:00.000Z');
    expect(window.delayMs).toBe(0);
    expect(window.notificationMayHaveLeft).toBe(false);
  });

  it('contrôle le contenu de la notification', () => {
    const check = checkNotification(
      'Voir TP-2 pour le détail.',
      context,
      '2026-11-12T09:00:00.000Z',
      '2026-11-12T09:00:10.000Z',
    );
    expect(check.allowed).toBe(false);
    expect(check.action).not.toBe('allow');
    expect(check.window.delayMs).toBe(10_000);
    expect(check.announcement.length).toBeGreaterThan(0);
  });

  it('laisse passer une notification sans fait signalable', () => {
    const check = checkNotification(
      'Votre commande est en route.',
      context,
      '2026-11-12T09:00:00.000Z',
      '2026-11-12T09:00:10.000Z',
    );
    expect(check.allowed).toBe(true);
    expect(check.action).toBe('allow');
  });
});

describe('hérédité sortante des commentaires internes (#39)', () => {
  it('fait passer par le sas un commentaire interne qui porte du texte externe', () => {
    const check = checkInternalCopy({
      text: 'Voir TP-2 pour le détail.',
      inheritedTrust: 'T0',
      context,
    });
    expect(check.checked).toBe(true);
    expect(check.inherits).toBe('T0');
    expect(check.allowed).toBe(false);
    expect(check.note).toContain('T0');
  });

  it('laisse passer un commentaire interne sans texte d’origine externe', () => {
    const check = checkInternalCopy({
      text: 'Relance le client demain.',
      inheritedTrust: 'T3',
      context,
    });
    expect(check.checked).toBe(false);
    expect(check.inherits).toBeNull();
    expect(check.allowed).toBe(true);
    expect(check.action).toBe('unchecked');
    expect(check.note).toContain('aucun contrôle');
  });
});
