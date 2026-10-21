// Интеграционные тесты ПР №5 (Задание 2.2): клиентский слой dApp (shared/registry.js)
// + RPC + развёрнутый контракт на реальном узле Anvil. Без моков блокчейна.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AbstractSigner, JsonRpcProvider, keccak256, toUtf8Bytes, makeError } from 'ethers';
import { startAnvil } from '../scripts/anvil.mjs';
import { deployRegistry } from '../scripts/deploy.mjs';
import { RegistryClient, Stage } from '../shared/registry.js';
import { ErrorKind, TxError } from '../shared/errors.js';
import { EventFeed, fetchEvents } from '../shared/events.js';
import { ROLES } from '../shared/config.js';
import { checkInvariants } from '../shared/invariants.js';

let anvil, provider, dep, admin, tech, stranger;
const DOC = keccak256(toUtf8Bytes('Акт ТО №17 от 2026-10-21, станок CNC-07'));

/** Подписант, который «нажимает Отклонить» в кошельке: ethers v6 ACTION_REJECTED (EIP-1193 4001). */
class RejectingSigner extends AbstractSigner {
  constructor(inner) {
    super(inner.provider);
    this.inner = inner;
  }
  getAddress() {
    return this.inner.getAddress();
  }
  connect() {
    return this;
  }
  signTransaction() {
    throw makeError('user rejected action', 'ACTION_REJECTED', { action: 'sendTransaction', reason: 'rejected' });
  }
  signMessage() {
    throw new Error('not used');
  }
  signTypedData() {
    throw new Error('not used');
  }
  async sendTransaction() {
    throw makeError('user rejected action', 'ACTION_REJECTED', { action: 'sendTransaction', reason: 'rejected', info: { error: { code: 4001, message: 'User denied transaction signature.' } } });
  }
}

function clientFor(signer) {
  return new RegistryClient({ address: dep.address, provider, signer });
}

async function expectTxError(promise) {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(TxError);
    return e;
  }
  throw new Error('ожидалась ошибка, но транзакция прошла');
}

beforeAll(async () => {
  anvil = await startAnvil({ port: 8555 });
  dep = await deployRegistry({ rpcUrl: anvil.url, log: () => {} });
  provider = new JsonRpcProvider(anvil.url, undefined, { staticNetwork: true, pollingInterval: 50, cacheTimeout: -1 });
  admin = await provider.getSigner(dep.accounts.admin);
  tech = await provider.getSigner(dep.accounts.technician);
  stranger = await provider.getSigner(dep.accounts.stranger);
});

afterAll(async () => {
  provider?.destroy();
  await anvil?.stop();
});

describe('Положительные сценарии', () => {
  it('IT1: инженер регистрирует этап ТО — этапы, квитанция, состояние, событие', async () => {
    const stages = [];
    const before = await clientFor(tech).totalRecords();
    const ts = (await provider.getBlock('latest')).timestamp;
    const r = await clientFor(tech).registerService(
      { machineId: 'CNC-07', serviceCode: 101, timestamp: ts, documentHash: DOC },
      { onStage: (s) => stages.push(s) },
    );
    expect(stages).toEqual([Stage.CHECKING, Stage.SIGNING, Stage.SENT, Stage.CONFIRMING, Stage.SUCCESS]);
    expect(r.receipt.status).toBe(1);
    // изменение состояния
    const last = await clientFor(tech).getLastService('CNC-07');
    expect(last).toMatchObject({ serviceCode: 101, technician: dep.accounts.technician, documentHash: DOC, revoked: false, exists: true });
    expect(await clientFor(tech).totalRecords()).toBe(before + 1n);
    // событие из квитанции
    expect(r.events.map((e) => e.name)).toEqual(['ServiceRegistered']);
    expect(r.events[0].args.serviceCode).toBe(101n);
    expect(r.events[0].args.technician).toBe(dep.accounts.technician);
    expect(await clientFor(tech).verifyDocument('CNC-07', DOC)).toBe(true);
  });

  it('IT2: администратор отзывает запись — событие ServiceRevoked, документ больше не подтверждается', async () => {
    const r = await clientFor(admin).revokeLastService('CNC-07');
    expect(r.receipt.status).toBe(1);
    expect(r.events[0].name).toBe('ServiceRevoked');
    expect(r.events[0].args.admin).toBe(dep.accounts.admin);
    expect((await clientFor(admin).getLastService('CNC-07')).revoked).toBe(true);
    expect(await clientFor(admin).verifyDocument('CNC-07', DOC)).toBe(false);
  });
});

describe('Негативные сценарии и авторизация', () => {
  it('IT3: посторонний не может зарегистрировать ТО — откат до подписи, nonce и состояние не изменились', async () => {
    const nonceBefore = await provider.getTransactionCount(dep.accounts.stranger);
    const totalBefore = await clientFor(stranger).totalRecords();
    const stages = [];
    const ts = (await provider.getBlock('latest')).timestamp;
    const e = await expectTxError(
      clientFor(stranger).registerService({ machineId: 'PRESS-02', serviceCode: 201, timestamp: ts, documentHash: DOC }, { onStage: (s) => stages.push(s) }),
    );
    expect(e.kind).toBe(ErrorKind.REVERT);
    expect(e.phase).toBe('preflight');
    expect(e.name).toBe('AccessControlUnauthorizedAccount');
    expect(e.args.account).toBe(dep.accounts.stranger);
    expect(e.args.neededRole).toBe(ROLES.TECHNICIAN_ROLE);
    expect(stages).toEqual([Stage.CHECKING, Stage.ERROR]); // до подписи не дошли
    expect(await provider.getTransactionCount(dep.accounts.stranger)).toBe(nonceBefore);
    expect(await clientFor(stranger).totalRecords()).toBe(totalBefore);
  });

  it('IT4: инженер не может выполнить привилегированную операцию pause()', async () => {
    const e = await expectTxError(clientFor(tech).pause());
    expect(e.name).toBe('AccessControlUnauthorizedAccount');
    expect(e.args.neededRole).toBe(ROLES.ADMIN_ROLE);
    expect(await clientFor(tech).paused()).toBe(false);
  });

  it('IT5: откат в блокчейне — status 0, событий в журнале нет, причина раскодирована по квитанции', async () => {
    const blockBefore = await provider.getBlockNumber();
    const e = await expectTxError(clientFor(stranger).pause({ skipPreflight: true, gasLimit: 100_000 }));
    expect(e.phase).toBe('onchain');
    expect(e.status).toBe(0);
    expect(e.blockNumber).toBe(blockBefore + 1);
    expect(e.receipt.logs).toHaveLength(0); // события откатившейся транзакции не сохраняются
    expect(e.name).toBe('AccessControlUnauthorizedAccount');
    const logs = await provider.getLogs({ address: dep.address, fromBlock: e.blockNumber, toBlock: e.blockNumber });
    expect(logs).toHaveLength(0);
    expect(await clientFor(stranger).paused()).toBe(false);
  });

  it('IT6: отказ в подписи — ошибка USER_REJECTED, транзакция не отправлена', async () => {
    const stages = [];
    const nonceBefore = await provider.getTransactionCount(dep.accounts.admin);
    const e = await expectTxError(clientFor(new RejectingSigner(admin)).pause({ onStage: (s) => stages.push(s) }));
    expect(e.kind).toBe(ErrorKind.USER_REJECTED);
    expect(stages).toEqual([Stage.CHECKING, Stage.SIGNING, Stage.ERROR]);
    expect(await provider.getTransactionCount(dep.accounts.admin)).toBe(nonceBefore);
  });

  it('IT7: неверная сеть — запись блокируется до подписи', async () => {
    const other = await startAnvil({ port: 8556, chainId: 11155111 }); // «Sepolia»-chainId
    try {
      const p2 = new JsonRpcProvider(other.url, undefined, { staticNetwork: true, cacheTimeout: -1 });
      const s2 = await p2.getSigner(dep.accounts.admin);
      const c = new RegistryClient({ address: dep.address, provider: p2, signer: s2 });
      const e = await expectTxError(c.pause());
      expect(e.kind).toBe(ErrorKind.WRONG_NETWORK);
      expect(e.args).toEqual({ chainId: '11155111', expected: '31337' });
      p2.destroy();
    } finally {
      await other.stop();
    }
  });

  it('IT8: пауза блокирует запись (EnforcedPause), после снятия запись снова работает', async () => {
    await clientFor(admin).pause();
    const ts = (await provider.getBlock('latest')).timestamp;
    const e = await expectTxError(clientFor(tech).registerService({ machineId: 'LATHE-05', serviceCode: 401, timestamp: ts, documentHash: DOC }));
    expect(e.name).toBe('EnforcedPause');
    await clientFor(admin).unpause();
    const r = await clientFor(tech).registerService({ machineId: 'LATHE-05', serviceCode: 401, timestamp: ts, documentHash: DOC });
    expect(r.receipt.status).toBe(1);
  });

  it('IT9: валидация входных данных — нулевой код и время из будущего', async () => {
    const ts = (await provider.getBlock('latest')).timestamp;
    const e1 = await expectTxError(clientFor(tech).registerService({ machineId: 'CNC-07', serviceCode: 0, timestamp: ts, documentHash: DOC }));
    expect(e1.name).toBe('InvalidServiceCode');
    const e2 = await expectTxError(clientFor(tech).registerService({ machineId: 'CNC-07', serviceCode: 101, timestamp: ts + 3600, documentHash: DOC }));
    expect(e2.name).toBe('TimestampInFuture');
  });
});

describe('События и инварианты', () => {
  it('IT10: лента событий без дублей при перекрытии истории и live-опроса', async () => {
    const head = await provider.getBlockNumber();
    const feed = new EventFeed();
    const all = await fetchEvents(provider, dep.address, dep.deployBlock, head);
    expect(feed.addMany(all)).toBe(all.length); // первичная загрузка
    // live-опрос с перекрытием: последние 5 блоков ещё раз + история целиком при «переподключении»
    const overlap = await fetchEvents(provider, dep.address, head - 5, head);
    expect(feed.addMany(overlap)).toBe(0);
    expect(feed.addMany(all)).toBe(0);
    expect(feed.size).toBe(all.length);
    expect(feed.duplicates).toBe(overlap.length + all.length);
    const names = new Set(feed.list().map((x) => x.name));
    for (const n of ['ServiceRegistered', 'ServiceRevoked', 'Paused', 'Unpaused', 'RoleGranted']) expect(names.has(n)).toBe(true);
  });

  it('IT11: три инварианта выполняются на развёрнутом контракте после всех сценариев', async () => {
    const r = await checkInvariants(provider, dep.address, dep.deployBlock);
    expect(r.I1.ok, r.I1.details.join('; ')).toBe(true);
    expect(r.I2.ok, r.I2.details.join('; ')).toBe(true);
    expect(r.I3.ok, r.I3.details.join('; ')).toBe(true);
  });

  it('IT12: негативный контроль — на уязвимой версии ПР №3 проверка обнаруживает нарушение I1', async () => {
    const vuln = await deployRegistry({ rpcUrl: anvil.url, variant: 'vulnerable', grantLoadClients: false, log: () => {} });
    const ts = (await provider.getBlock('latest')).timestamp;
    const t = new RegistryClient({ address: vuln.address, provider, signer: tech });
    await t.registerService({ machineId: 'CNC-07', serviceCode: 101, timestamp: ts, documentHash: DOC });
    // посторонний отзывает запись — в уязвимой версии это проходит
    const s = new RegistryClient({ address: vuln.address, provider, signer: stranger });
    const r = await s.revokeLastService('CNC-07');
    expect(r.receipt.status).toBe(1);
    const inv = await checkInvariants(provider, vuln.address, vuln.deployBlock);
    expect(inv.I1.ok).toBe(false);
    expect(inv.I1.details[0]).toMatch(/ServiceRevoked .* без нужной роли/);
  });
});
