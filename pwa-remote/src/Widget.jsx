import React, { Suspense, lazy, useState } from 'react';

// Lazy chunk on purpose: it is only requested when the user clicks the button,
// so it shows whether the host's cache warm-up also stores async remote chunks.
const Details = lazy(() => import('./Details.jsx'));

export default function Widget() {
  const [count, setCount] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  return (
    <section data-testid="remote-widget" style={{ border: '2px dashed #646cff', padding: 16 }}>
      <h2>Remote widget (served from :5181)</h2>
      <button data-testid="remote-counter" onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>{' '}
      <button data-testid="remote-details-toggle" onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? 'Hide' : 'Show'} lazy details
      </button>
      {showDetails && (
        <Suspense fallback={<p>Loading details…</p>}>
          <Details />
        </Suspense>
      )}
    </section>
  );
}
