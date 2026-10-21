// Прикладной журнал (телеметрия) в едином формате JSON Lines.
// Каждая запись: ts (ISO-8601, UTC), source, category, event, correlationId + поля.
// Секреты (ключи, мнемоники, пароли, подписи) вырезаются ДО записи.

const SECRET_KEY = /(private.?key|mnemonic|seed|password|passwd|secret|signature|authorization|api.?key|token)/i;

export function newCorrelationId() {
  return globalThis.crypto.randomUUID();
}

export function redact(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) {
        out[k] = '[REDACTED]';
        continue;
      }
      if (k === 'receipt' || k === 'raw') continue; // крупные объекты не логируем
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * @param {object} o
 * @param {string} o.source  'dapp' | 'monitor' | 'loadtest' | 'test'
 * @param {Array<(rec:object)=>void>} o.sinks
 */
export function createTelemetry({ source, sinks = [] }) {
  return function log(rec) {
    const record = redact({
      ts: new Date().toISOString(),
      source,
      category: rec.category ?? 'app',
      event: rec.event ?? 'log',
      correlationId: rec.correlationId ?? null,
      ...rec,
    });
    for (const s of sinks) {
      try {
        s(record);
      } catch {
        /* журнал не должен ронять приложение */
      }
    }
    return record;
  };
}
