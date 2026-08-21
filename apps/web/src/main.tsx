import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

/**
 * Retry is off. Every 4xx this API returns is a decision the server made - a version
 * conflict, a refused transition, a validation failure - and retrying it would just make
 * the same request fail three more times before the user is told.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

const container = document.getElementById('root');

if (container === null) {
  throw new Error('index.html is missing #root');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
