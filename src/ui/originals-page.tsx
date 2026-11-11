/**
 * Originaux conservés (§17.6) — écran du lot UI.
 * Accès réservé au rôle sécurité (tranché par le résolveur, jamais ici) ; le
 * texte est affiché **inerte** : jamais rendu comme du markup. Restauration
 * journalisée. Aucune logique métier : l'écran appelle le pont (`api.ts`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { t } from '../core/i18n';
import type { Language } from '../core/types';
import { getOriginal, listOriginals, restoreOriginal, type OriginalView } from './api';
import type { AsyncState } from './context';
import { shortDate } from './format';
import { Banner, Box, Button, Spinner, Stack, Table, Cell, Head, Row, Text } from './kit';

function OriginalContent({ id, language }: { id: string; language: Language }): JSX.Element {
  const [state, setState] = useState<AsyncState<OriginalView>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await getOriginal(id);
      if (cancelled) return;
      setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.error });
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <Banner appearance="error">{state.message}</Banner>;
  return (
    <Stack space="space.050">
      <Text>{t(language, 'ui.originals.inert')}</Text>
      <Text>{state.data.contentInert ?? ''}</Text>
    </Stack>
  );
}

function OriginalsTable({
  rows,
  language,
  openedId,
  onOpen,
  onRestore,
}: {
  rows: OriginalView[];
  language: Language;
  openedId: string | null;
  onOpen: (id: string) => void;
  onRestore: (id: string) => void;
}): JSX.Element {
  return (
    <Table>
      <Head>
        <Cell>{t(language, 'ui.originals.issue')}</Cell>
        <Cell>{t(language, 'ui.originals.col.stored')}</Cell>
        <Cell>{t(language, 'ui.originals.open')}</Cell>
        <Cell>{t(language, 'ui.originals.restore')}</Cell>
      </Head>
      {rows.map((row) => (
        <Row key={row.id}>
          <Cell>{row.issueKey}</Cell>
          <Cell>{shortDate(row.storedAt)}</Cell>
          <Cell>
            <Button appearance="link" text={t(language, 'ui.originals.open')} onClick={() => onOpen(row.id)} />
          </Cell>
          <Cell>
            <Button appearance="subtle" text={t(language, 'ui.originals.restore')} onClick={() => onRestore(row.id)} />
          </Cell>
        </Row>
      ))}
      {openedId ? (
        <Row key={`${openedId}-content`}>
          <Cell>
            <OriginalContent id={openedId} language={language} />
          </Cell>
          <Cell> </Cell>
          <Cell> </Cell>
          <Cell> </Cell>
        </Row>
      ) : null}
    </Table>
  );
}

export function OriginalsPage({ language }: { language: Language }): JSX.Element {
  const [state, setState] = useState<AsyncState<OriginalView[]>>({ status: 'loading' });
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await listOriginals();
    setState(result.ok ? { status: 'ready', data: result.data } : { status: 'error', message: result.error });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (id: string): Promise<void> => {
    const result = await restoreOriginal(id);
    setMessage(result.ok ? t(language, 'ui.originals.restored') : result.error);
    if (result.ok) await load();
  };

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'error') return <Banner appearance="error">{state.message}</Banner>;
  return (
    <Stack space="space.200">
      <Text>{t(language, 'ui.originals.title')}</Text>
      {message ? <Banner appearance="success">{message}</Banner> : null}
      {state.data.length === 0 ? <Text>{t(language, 'ui.originals.empty')}</Text> : null}
      {state.data.length > 0 ? (
        <Box>
          <OriginalsTable
            rows={state.data}
            language={language}
            openedId={openedId}
            onOpen={setOpenedId}
            onRestore={(id) => void restore(id)}
          />
        </Box>
      ) : null}
      <Text>{t(language, 'ui.reduceRisk')}</Text>
    </Stack>
  );
}
