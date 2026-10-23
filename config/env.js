/**
 * Every environment variable the app reads, validated once at startup. Code
 * elsewhere imports from here instead of reading process.env, so a missing or
 * malformed value fails at boot rather than on the first request that needs it.
 */
require('dotenv').config();

function readEnv(source = process.env) {
  const errors = [];
  const required = (key) => {
    const value = source[key];
    if (!value) errors.push(`${key} is required`);
    return value;
  };

  const nodeEnv = source.NODE_ENV || 'development';
  const port = Number(source.PORT || 5000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) errors.push('PORT must be a port number');

  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret && nodeEnv === 'production' && sessionSecret.length < 32) {
    errors.push('SESSION_SECRET must be at least 32 characters in production');
  }

  const env = Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port,
    mongoUri: required('MONGO_URI'),
    sessionSecret,
    // Set when running behind a reverse proxy (Render, Fly, nginx) so secure
    // cookies and req.ip see the client, not the proxy.
    trustProxy: ['1', 'true', 'yes'].includes(String(source.TRUST_PROXY || '').toLowerCase()),
    puppeteerExecutablePath: source.PUPPETEER_EXECUTABLE_PATH || null,
  });

  return { env, errors };
}

module.exports = { readEnv };
