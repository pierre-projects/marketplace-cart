/**
 * The one way page scripts talk to the server.
 *
 * Every fetch used to hand-roll its own headers and call res.json() blindly.
 * An expired session answers with a redirect to the HTML login page, so the
 * user saw a raw JSON parse error. Here the response type is checked, the
 * CSRF token and Accept header always go along, and failures arrive as an
 * ApiError carrying the server's own message.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** The session's CSRF token, rendered into the layout <head>. */
export function csrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content || '';
}

const SESSION_EXPIRED = 'Your session expired. Sign in again to continue.';

/**
 * @param {string} url
 * @param {{method?: string, json?: object, form?: FormData|URLSearchParams, signal?: AbortSignal}} [opts]
 * @returns {Promise<any>} the parsed JSON body
 */
export async function api(url, { method = 'GET', json, form, signal } = {}) {
  const headers = { Accept: 'application/json' };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form instanceof URLSearchParams ? form : new URLSearchParams(form);
  }
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken();

  const res = await fetch(url, { method, headers, body, signal, credentials: 'same-origin' });

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  if (!isJson) {
    // fetch follows redirects silently; landing on the login page means the
    // session is gone.
    const toLogin = res.redirected && new URL(res.url).pathname.startsWith('/auth/login');
    throw new ApiError(
      toLogin || res.status === 401 ? SESSION_EXPIRED : 'Unexpected response from the server.',
      { status: res.status }
    );
  }

  const data = await res.json();
  if (!res.ok) {
    throw new ApiError(data?.error || 'Something went wrong. Please try again.', {
      status: res.status, code: data?.code || null, body: data,
    });
  }
  return data;
}

/**
 * Resolve after `ms`, or reject with AbortError when `signal` aborts. Removes
 * its abort listener either way — the old inline version added one per poll
 * and never took it off.
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
