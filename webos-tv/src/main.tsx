import App from './App';
import { Splash } from './components/Splash';
import { PlayerResolutionFrame } from './components/PlayerResolutionFrame';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { detectLanguage, translator } from './app/i18n';
import { openServices, type ServicesResult } from './app/services';
import { ensureRuntime, isPackagedTV } from './platform/runtime';
import './styles.css';

type Boot = { phase: 'loading' } | { phase: 'runtime-error'; message: string } | { phase: 'ready'; result: ServicesResult };

function Bootstrap() {
  const t = translator(detectLanguage());
  const [boot, setBoot] = useState<Boot>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setBoot({ phase: 'loading' });
    void (async () => {
      try {
        if (isPackagedTV()) await ensureRuntime();
      } catch (reason) {
        if (active) setBoot({ phase: 'runtime-error', message: (reason as Error).message });
        return;
      }
      const result = await openServices({ audio: document.createElement('audio') });
      if (active) setBoot({ phase: 'ready', result });
    })();
    return () => { active = false; };
  }, [attempt]);

  const retry = () => setAttempt((value) => value + 1);
  const [splashGone, setSplashGone] = useState(false);
  const loaded = boot.phase === 'ready' && boot.result.ok;
  if (boot.phase === 'loading' || loaded) {
    return (
      <>
        {boot.phase === 'ready' && boot.result.ok ? <App services={boot.result.services} /> : null}
        {splashGone ? null : <Splash leaving={loaded} label={boot.phase === 'loading' ? t('boot.service') : undefined} alt={t('app.name')} onDone={() => setSplashGone(true)} />}
      </>
    );
  }
  return (
    <PlayerResolutionFrame active={false}>
    <main class="boot-state" aria-live="polite">
      <img src="./icon.png" alt={t('app.name')} />
      {boot.phase === 'runtime-error' && <><p>{boot.message}</p><button autoFocus onClick={retry}>{t('common.retry')}</button></>}
      {boot.phase === 'ready' && !boot.result.ok && (
        <>
          <h1>{t('storage.failed.title')}</h1>
          <p>{boot.result.error.message}</p>
          <p>{t('storage.failed.body')}</p>
          <button autoFocus onClick={retry}>{t('common.retry')}</button>
        </>
      )}
    </main>
    </PlayerResolutionFrame>
  );
}
render(<Bootstrap />, document.getElementById('app')!);
