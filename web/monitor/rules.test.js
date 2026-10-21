// Unit-тесты правил обнаружения (Задание 3.2): порог, окно, защита от повторов, штатный сценарий.
import { describe, it, expect } from 'vitest';
import { Detector, signalsOf } from './rules.mjs';

const T0 = Date.parse('2026-10-21T10:00:00.000Z');
const at = (sec) => new Date(T0 + sec * 1000).toISOString();
const ATTACKER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

const deniedPreflight = (sec, from = ATTACKER) => ({
  ts: at(sec), category: 'app', event: 'tx.error', kind: 'REVERT', phase: 'preflight',
  name: 'AccessControlUnauthorizedAccount', from, args: { account: from }, correlationId: `cid-${sec}`,
});
const revertedReceipt = (sec, txHash, from = ATTACKER) => ({
  ts: at(sec), category: 'receipt', event: 'tx.reverted', status: 0, from, txHash,
  error: { name: 'AccessControlUnauthorizedAccount' },
});
const rpcError = (sec) => ({ ts: at(sec), category: 'rpc', event: 'rpc.error', endpoint: 'http://127.0.0.1:8545', code: 'TIMEOUT' });

describe('R1 — попытки нарушения доступа', () => {
  it('срабатывает на 3-й попытке за 300 с и не срабатывает на 2-й', () => {
    const d = new Detector();
    expect(d.ingest(deniedPreflight(0))).toHaveLength(0);
    expect(d.ingest(deniedPreflight(30))).toHaveLength(0);
    const fired = d.ingest(revertedReceipt(60, '0xaa'));
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ ruleId: 'R1', severity: 'HIGH', count: 3, subject: ATTACKER.toLowerCase() });
  });

  it('не считает дважды один откат, пришедший из dApp и из квитанции', () => {
    const d = new Detector();
    d.ingest({ ...deniedPreflight(0), phase: 'onchain', txHash: '0xbb' });
    d.ingest(revertedReceipt(1, '0xbb'));
    d.ingest(deniedPreflight(2));
    expect(d.alerts).toHaveLength(0); // это 2 попытки, а не 3
  });

  it('попытки за пределами окна 300 с не накапливаются', () => {
    const d = new Detector();
    d.ingest(deniedPreflight(0));
    d.ingest(deniedPreflight(200));
    d.ingest(deniedPreflight(520)); // первая попытка уже вне окна
    expect(d.alerts).toHaveLength(0);
  });

  it('защита от повторных уведомлений: 6 попыток подряд -> 1 тревога, 3 подавлены', () => {
    const d = new Detector();
    for (let i = 0; i < 6; i++) d.ingest(deniedPreflight(i * 10));
    expect(d.alerts.filter((a) => a.event === 'alert.fired')).toHaveLength(1);
    expect(d.suppressed).toBe(3);
    expect(d.alerts[0].suppressed).toBe(3);
  });

  it('разные адреса считаются раздельно', () => {
    const d = new Detector();
    d.ingest(deniedPreflight(0, '0x1111111111111111111111111111111111111111'));
    d.ingest(deniedPreflight(1, '0x2222222222222222222222222222222222222222'));
    d.ingest(deniedPreflight(2, '0x3333333333333333333333333333333333333333'));
    expect(d.alerts).toHaveLength(0);
  });
});

describe('R2 — эксплуатационный сбой RPC', () => {
  it('3 ошибки RPC за 60 с -> тревога MEDIUM, затем resolved после восстановления', () => {
    const d = new Detector();
    d.ingest(rpcError(0));
    d.ingest(rpcError(3));
    const f = d.ingest(rpcError(6));
    expect(f[0]).toMatchObject({ ruleId: 'R2', severity: 'MEDIUM' });
    d.ingest(rpcError(9)); // подавлена
    const r = d.ingest({ ts: at(20), category: 'rpc', event: 'rpc.recovered', endpoint: 'http://127.0.0.1:8545', downtimeMs: 20000 });
    expect(r[0]).toMatchObject({ event: 'alert.resolved', ruleId: 'R2', suppressedDuringIncident: 1 });
  });

  it('2 ошибки за 60 с — не тревога (кратковременный сбой)', () => {
    const d = new Detector();
    d.ingest(rpcError(0));
    d.ingest(rpcError(50));
    d.ingest(rpcError(120));
    expect(d.alerts).toHaveLength(0);
  });
});

describe('Штатный сценарий', () => {
  it('успешные транзакции, события и один случайный отказ не вызывают тревог', () => {
    const d = new Detector();
    const ok = [
      { ts: at(0), category: 'app', event: 'tx.success', method: 'registerService', txHash: '0x01' },
      { ts: at(1), category: 'receipt', event: 'tx.mined', status: 1, from: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', txHash: '0x01' },
      { ts: at(1), category: 'event', event: 'contract.event', name: 'ServiceRegistered', txHash: '0x01', logIndex: 0 },
      deniedPreflight(5, '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'), // инженер ошибся кнопкой
      { ts: at(9), category: 'app', event: 'tx.error', kind: 'USER_REJECTED', name: 'UserRejected' },
    ];
    for (const r of ok) d.ingest(r);
    expect(d.alerts).toHaveLength(0);
    expect(signalsOf(ok[1])).toHaveLength(0);
  });
});
