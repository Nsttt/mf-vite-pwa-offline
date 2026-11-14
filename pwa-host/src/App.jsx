import React, { Suspense, lazy, useEffect, useState } from 'react';

const RemoteWidget = lazy(() => import('pwaRemote/Widget'));

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function useWarmStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const onWarm = (event) => setStatus(event.detail);
    window.addEventListener('mf-offline:warmed', onWarm);
    return () => window.removeEventListener('mf-offline:warmed', onWarm);
  }, []);
  return status;
}

class RemoteBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <p data-testid="remote-error" style={{ color: 'crimson' }}>
          Remote failed to load: {String(this.state.error.message ?? this.state.error)}
        </p>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const online = useOnline();
  const warm = useWarmStatus();

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>MF + PWA offline host</h1>
      <p data-testid="network-status">
        Network: <strong>{online ? 'online' : 'offline'}</strong>
        {warm && (
          <span data-testid="warm-status">
            {' '}
            · {warm.remote} cached ({warm.total - warm.failed}/{warm.total} assets)
          </span>
        )}
      </p>
      <p>
        Load once online, then go offline (DevTools → Network → Offline) and reload. The remote
        below should still render from the service worker cache.
      </p>
      <RemoteBoundary>
        <Suspense fallback={<p>Loading remote…</p>}>
          <RemoteWidget />
        </Suspense>
      </RemoteBoundary>
    </main>
  );
}
