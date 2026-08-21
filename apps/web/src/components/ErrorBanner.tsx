import type { JSX } from 'react';

import { ApiError } from '../api/client';

/**
 * The server already decided what went wrong and said so in one envelope. This shows that
 * decision rather than inventing a friendlier one - a client that rewrites "you cannot
 * skip a status" into "something went wrong" is throwing away the useful half.
 */
export function ErrorBanner({ error }: { error: unknown }): JSX.Element | null {
  if (error === null || error === undefined) {
    return null;
  }

  if (!(error instanceof ApiError)) {
    return (
      <div className="banner error">
        <strong>Unexpected error</strong>
        <p>{error instanceof Error ? error.message : String(error)}</p>
      </div>
    );
  }

  // Field-level details are shown inline by the form; only the rest belong up here.
  const generalDetails = error.details.filter((detail) => !detail.path.startsWith('data.'));

  return (
    <div className="banner error">
      <strong>
        {error.code} <span className="muted">({error.status})</span>
      </strong>
      <p>{error.message}</p>
      {generalDetails.length > 0 && (
        <ul>
          {generalDetails.map((detail) => (
            <li key={`${detail.path}:${detail.message}`}>
              <code>{detail.path}</code> {detail.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
