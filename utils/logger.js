const logger = {
  info: (...args) => process.env.NODE_ENV !== 'test' && console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => process.env.NODE_ENV === 'development' && console.log('[DEBUG]', ...args),
};

module.exports = logger;
