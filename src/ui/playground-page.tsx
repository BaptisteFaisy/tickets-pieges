/**
 * Banc d'essai (§17.7) — écran du lot UI.
 * Rejouer les demandes d'exemple et voir ce que chaque couche détecte, et ce
 * qui n'a pas été rejoué (§21 : pas de fausse assurance). Aucune logique
 * métier : l'écran appelle le pont (`api.ts`).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { suspicionLabel, t, trustLabel } from '../core/i18n';
import type { Language, SampleRequest } from '../core/types';
import { listSamples, runPlayground, type PlaygroundResult } from './api';
import type { AsyncState } from './context';
import { confidenceLabel } from './format';
import { Badge, Banner, Box, Button, Spinner, Stack, Table, Cell, Head, Row, Text } from './kit';

function ResultPane({ result, language }: { result: PlaygroundResult; language: Language }): JSX.Element {
  return (
    <Stack space="space.100">
      <Text>{t(language, 'ui.playground.result')}</Text>
      <Box>
        <Stack space="space.100">
          <Badge appearance="neutral" text={`${trustLabel(language, result.trustLevel)} → ${suspicionLabel(language, result.suspicionLevel)}`} />
        </Stack>
      </Box>
      <Text>
        {t(language, 'ui.playground.expected')} : {result.expected.trustLevel} /{' '}
        {suspicionLabel(language, result.expected.suspicion)} / {result.expected.kinds.join(', ') || '—'}
      </Text>
      {result.findings.map((finding) => (
        <Stack key={finding.id} space="space.050">
          <Box>
            <Stack space="space.100">
              <Badge appearance="removed" text={finding.layer} />
              <Badge appearance="neutral" text={finding.kind} />
              <Badge appearance="default" text={confidenceLabel(finding.confidence)} />
            </Stack>
          </Box>
          <Text>{finding.askSummary}</Text>
          <Text>« {finding.excerpt} »</Text>
        </Stack>
      ))}
      {result.findings.length === 0 ? <Text>{t(language, 'ui.panel.noFindings')}</Text> : null}
      <Text>{t(language, 'ui.playground.notAnalyzed', { list: result.notAnalyzed.join(', ') })}</Text>
    </Stack>
  );
}

function SamplesTable({
  samples,
  language,
  onPlay,
}: {
  samples: SampleRequest[];
  language: Language;
  onPlay: (sampleId: string) => Promise<void>;
}): JSX.Element {
  return (
    <Table>
      <Head>
        <Cell>{t(language, 'ui.playground.samples')}</Cell>
        <Cell>{language === 'fr' ? 'Langue' : 'Language'}</Cell>
        <Cell>{t(language, 'ui.playground.run')}</Cell>
      </Head>
      {samples.map((sample) => (
        <Row key={sample.id}>
          <Cell>{sample.summary}</Cell>
          <Cell>{sample.language}</Cell>
          <Cell>
            <Button appearance="subtle" text={t(language, 'ui.playground.run')} onClick={() => void onPlay(sample.id)} />
          </Cell>
        </Row>
      ))}
    </Table>
  );
}

export function PlaygroundPage({ language }: { language: Language }): JSX.Element {
  const [samples, setSamples] = useState<AsyncState<SampleRequest[]>>({ status: 'loading' });
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const listed = await listSamples();
      setSamples(listed.ok ? { status: 'ready', data: listed.data } : { status: 'error', message: listed.error });
    })();
  }, []);

  const play = useCallback(async (sampleId: string) => {
    const played = await runPlayground(sampleId);
    if (played.ok) {
      setResult(played.data);
      setError(null);
    } else {
      setResult(null);
      setError(played.error);
    }
  }, []);

  if (samples.status === 'loading') return <Spinner />;
  if (samples.status === 'error') return <Banner appearance="error">{samples.message}</Banner>;
  return (
    <Stack space="space.200">
      <Text>{t(language, 'ui.playground.title')}</Text>
      <Text>{t(language, 'ui.playground.intro')}</Text>
      {error ? <Banner appearance="error">{error}</Banner> : null}
      {samples.data.length === 0 ? <Text>{t(language, 'ui.playground.empty')}</Text> : null}
      <SamplesTable samples={samples.data} language={language} onPlay={play} />
      {result ? <ResultPane result={result} language={result.language} /> : null}
      <Text>{t(language, 'ui.reduceRisk')}</Text>
    </Stack>
  );
}
