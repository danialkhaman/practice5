// Правила обнаружения (Задание 3.2) и движок со скользящим окном и защитой от повторных уведомлений.
// Чистая логика без сети: время берётся из поля ts записи телеметрии, поэтому правила
// детерминированно проверяются unit-тестами (monitor/rules.test.js).

export const RULES = {
  R1: {
    id: 'R1',
    name: 'Попытки нарушения доступа',
    description:
      'Адрес без нужной роли пытается вызвать изменяющую функцию: контракт отвечает AccessControlUnauthorizedAccount.',
    sources: [
      'квитанции транзакций: status = 0, причина AccessControlUnauthorizedAccount (откат уже в блоке)',
      'журнал приложения: tx.error, name = AccessControlUnauthorizedAccount (отказ при предварительной проверке eth_call)',
    ],
    subject: 'адрес инициатора (from)',
    threshold: 3,
    windowSec: 300,
    severity: 'HIGH',
    cooldownSec: 600,
    reaction:
      'Оповестить администратора; проверить адрес и выданные роли; при продолжении — pause() и отзыв ролей у скомпрометированных аккаунтов.',
  },
  R2: {
    id: 'R2',
    name: 'Эксплуатационный сбой RPC/узла',
    description: 'Запросы к RPC-узлу завершаются ошибкой или таймаутом: клиенты не могут читать состояние и отправлять транзакции.',
    sources: ['ошибки RPC монитора (таймаут, ECONNREFUSED, ответ 5xx)', 'журнал приложения: ошибки вида RPC у пользователей dApp'],
    subject: 'адрес RPC-узла (endpoint)',
    threshold: 3,
    windowSec: 60,
    severity: 'MEDIUM',
    cooldownSec: 300,
    reaction: 'Оповестить дежурного; переключить клиентов на резервный RPC; проверить процесс узла; после восстановления — уведомление resolved.',
  },
};

/** Из записи телеметрии извлекает сигналы правил: [{ruleId, subject, dedupe}] */
export function signalsOf(rec) {
  const out = [];
  // R1: откат в блоке, причина — отсутствие роли
  if (rec.category === 'receipt' && rec.status === 0 && rec.error?.name === 'AccessControlUnauthorizedAccount') {
    out.push({ ruleId: 'R1', subject: String(rec.from).toLowerCase(), dedupe: rec.txHash ?? null });
  }
  // R1: отказ на предварительной проверке в dApp (транзакция в сеть не ушла — событий и квитанции нет)
  if (rec.category === 'app' && rec.event === 'tx.error' && rec.name === 'AccessControlUnauthorizedAccount') {
    const who = rec.from ?? rec.args?.account;
    if (who) out.push({ ruleId: 'R1', subject: String(who).toLowerCase(), dedupe: rec.txHash ?? null });
  }
  // R2: ошибки RPC — у монитора и у клиентов
  if (rec.category === 'rpc' && rec.event === 'rpc.error') {
    out.push({ ruleId: 'R2', subject: rec.endpoint ?? 'rpc', dedupe: null });
  }
  if (rec.category === 'app' && rec.event === 'tx.error' && rec.kind === 'RPC') {
    out.push({ ruleId: 'R2', subject: rec.endpoint ?? 'rpc', dedupe: null });
  }
  return out;
}

export class Detector {
  /**
   * @param {object} [o]
   * @param {object} [o.rules] переопределение порогов (для тестов)
   * @param {(alert:object)=>void} [o.onAlert]
   * @param {(info:object)=>void} [o.onSuppress] вызывается на каждый подавленный повтор
   */
  constructor({ rules = RULES, onAlert = () => {}, onSuppress = () => {} } = {}) {
    this.rules = rules;
    this.onAlert = onAlert;
    this.onSuppress = onSuppress;
    this.windows = new Map(); // `${ruleId}|${subject}` -> [ms, ...]
    this.lastAlert = new Map(); // `${ruleId}|${subject}` -> {ms, alert}
    this.counted = new Set(); // `${ruleId}|${txHash}` — одна транзакция считается один раз
    this.suppressed = 0;
    this.alerts = [];
    this.seq = 0;
  }

  ingest(rec) {
    const now = Date.parse(rec.ts);
    const fired = [];
    for (const sig of signalsOf(rec)) {
      const rule = this.rules[sig.ruleId];
      if (sig.dedupe) {
        const k = `${sig.ruleId}|${sig.dedupe}`;
        if (this.counted.has(k)) continue; // тот же откат пришёл и из dApp, и из квитанции
        this.counted.add(k);
      }
      const key = `${sig.ruleId}|${sig.subject}`;
      const win = (this.windows.get(key) ?? []).filter((t) => now - t <= rule.windowSec * 1000);
      win.push(now);
      this.windows.set(key, win);
      if (win.length < rule.threshold) continue;

      const last = this.lastAlert.get(key);
      if (last && now - last.ms < rule.cooldownSec * 1000) {
        // защита от повторных уведомлений: та же тревога в пределах cooldown не отправляется
        last.alert.suppressed = (last.alert.suppressed ?? 0) + 1;
        this.suppressed++;
        this.onSuppress({
          ts: rec.ts, category: 'alert', event: 'alert.suppressed', alertId: last.alert.alertId, ruleId: rule.id,
          subject: sig.subject, count: win.length, suppressed: last.alert.suppressed, correlationId: rec.correlationId ?? null,
          cooldownLeftSec: Math.round((rule.cooldownSec * 1000 - (now - last.ms)) / 1000),
        });
        continue;
      }
      const alert = {
        ts: rec.ts,
        category: 'alert',
        event: 'alert.fired',
        alertId: `${rule.id}-${++this.seq}`,
        ruleId: rule.id,
        rule: rule.name,
        severity: rule.severity,
        subject: sig.subject,
        count: win.length,
        threshold: rule.threshold,
        windowSec: rule.windowSec,
        firstSeen: new Date(win[0]).toISOString(),
        lastSeen: rec.ts,
        correlationId: rec.correlationId ?? null,
        evidence: rec.txHash ?? rec.correlationId ?? null,
        reaction: rule.reaction,
        dedupeKey: key,
        suppressed: 0,
      };
      this.lastAlert.set(key, { ms: now, alert });
      this.alerts.push(alert);
      fired.push(alert);
      this.onAlert(alert);
    }
    // восстановление после R2
    if (rec.category === 'rpc' && rec.event === 'rpc.recovered') {
      const key = `R2|${rec.endpoint ?? 'rpc'}`;
      const last = this.lastAlert.get(key);
      if (last) {
        // инцидент закрыт: окно и cooldown сбрасываются, новый сбой снова даст тревогу
        this.lastAlert.delete(key);
        this.windows.delete(key);
        const resolved = {
          ts: rec.ts,
          category: 'alert',
          event: 'alert.resolved',
          alertId: last.alert.alertId,
          ruleId: 'R2',
          rule: this.rules.R2.name,
          severity: 'INFO',
          subject: rec.endpoint ?? 'rpc',
          downtimeMs: rec.downtimeMs ?? null,
          suppressedDuringIncident: last.alert.suppressed,
        };
        this.alerts.push(resolved);
        fired.push(resolved);
        this.onAlert(resolved);
      }
    }
    return fired;
  }
}
