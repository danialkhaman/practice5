import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserProvider, JsonRpcProvider, keccak256, isAddress, getAddress } from 'ethers';
import { RegistryClient, Stage, STAGE_LABELS } from '../shared/registry.js';
import { EventFeed, fetchEvents } from '../shared/events.js';
import { createTelemetry, newCorrelationId } from '../shared/telemetry.js';
import { decodeError, ErrorKind } from '../shared/errors.js';
import { EXPECTED_CHAIN_ID, SERVICE_CODES, shortAddr, shortHash, serviceLabel } from '../shared/config.js';
import { getEthereum, requestAccount, readChainId, revokeSession, switchToAnvil } from './wallet.js';

const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545';
const TELEMETRY_URL = import.meta.env.VITE_TELEMETRY_URL || 'http://localhost:8787/telemetry';
const STEPS = [Stage.CHECKING, Stage.SIGNING, Stage.SENT, Stage.CONFIRMING];
const ERROR_TITLES = {
  [ErrorKind.USER_REJECTED]: 'Подпись отклонена в кошельке',
  [ErrorKind.WRONG_NETWORK]: 'Неверная сеть',
  [ErrorKind.RPC]: 'Ошибка RPC-узла',
  [ErrorKind.UNKNOWN]: 'Ошибка',
};
const errorTitle = (e) =>
  e.kind === ErrorKind.REVERT ? (e.phase === 'onchain' ? `Откат транзакции в блоке ${e.blockNumber}` : 'Отклонено контрактом при проверке (eth_call)') : ERROR_TITLES[e.kind] ?? 'Ошибка';

// Чтение и события — через собственный RPC dApp; запись — только через кошелёк.
const readProvider = new JsonRpcProvider(RPC_URL, 31337, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 1000 });

async function fileHash(file) {
  return keccak256(new Uint8Array(await file.arrayBuffer()));
}

export default function App() {
  const eth = getEthereum();
  const [dep, setDep] = useState(null);
  const [depError, setDepError] = useState(null);
  const [wallet, setWallet] = useState({ status: 'disconnected', address: null, chainId: null });
  const [roles, setRoles] = useState(null);
  const [stats, setStats] = useState({ total: null, paused: null, block: null });
  const [tx, setTx] = useState({ stage: null });
  const [events, setEvents] = useState([]);
  const [feedStats, setFeedStats] = useState({ unique: 0, duplicates: 0, note: '' });
  const [appLog, setAppLog] = useState([]);
  const [collectorOk, setCollectorOk] = useState(null);
  const feedRef = useRef(new EventFeed());
  const lastBlockRef = useRef(null);
  const browserProviderRef = useRef(null);

  // ---------- прикладной журнал (телеметрия) ----------
  const log = useMemo(
    () =>
      createTelemetry({
        source: 'dapp',
        sinks: [
          (r) => console.debug('[telemetry]', r),
          (r) => setAppLog((prev) => [r, ...prev].slice(0, 14)),
          (r) => {
            fetch(TELEMETRY_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r), keepalive: true })
              .then((res) => setCollectorOk(res.ok))
              .catch(() => setCollectorOk(false));
          },
        ],
      }),
    [],
  );

  const reader = useMemo(() => (dep ? new RegistryClient({ address: dep.address, provider: readProvider, log }) : null), [dep, log]);
  const wrongNetwork = wallet.status === 'connected' && wallet.chainId !== EXPECTED_CHAIN_ID;

  // ---------- адрес контракта ----------
  useEffect(() => {
    fetch('/deployment.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setDep)
      .catch((e) => setDepError(`Нет public/deployment.json (${e.message}): выполните npm run deploy:local`));
  }, []);

  // ---------- чтение состояния ----------
  const refreshReads = useCallback(async () => {
    if (!reader) return;
    try {
      const [total, paused, block] = await Promise.all([reader.totalRecords(), reader.paused(), readProvider.getBlockNumber()]);
      setStats({ total: total.toString(), paused, block });
      if (wallet.address) setRoles(await reader.rolesOf(wallet.address));
    } catch (e) {
      const d = decodeError(e);
      log({ category: 'rpc', event: 'rpc.error', endpoint: RPC_URL, method: 'read', code: d.code, message: d.message });
    }
  }, [reader, wallet.address, log]);

  // ---------- события: история + опрос новых блоков с перекрытием ----------
  const pullEvents = useCallback(
    async (from, to, note = '') => {
      const logs = await fetchEvents(readProvider, dep.address, from, to);
      const added = feedRef.current.addMany(logs);
      setEvents(feedRef.current.list());
      setFeedStats({ unique: feedRef.current.size, duplicates: feedRef.current.duplicates, note: note && `${note}: получено ${logs.length}, новых ${added}, дублей отброшено ${logs.length - added}` });
    },
    [dep],
  );

  useEffect(() => {
    if (!dep) return;
    let stop = false;
    (async () => {
      const head = await readProvider.getBlockNumber();
      await pullEvents(dep.deployBlock, head);
      lastBlockRef.current = head;
      await refreshReads();
    })().catch(() => {});
    const onBlock = async (bn) => {
      if (stop || lastBlockRef.current === null) return;
      // перекрытие 2 блока: повторно полученные события отбрасывает EventFeed
      await pullEvents(Math.max(dep.deployBlock, lastBlockRef.current - 2), bn).catch(() => {});
      lastBlockRef.current = bn;
      refreshReads();
    };
    readProvider.on('block', onBlock);
    return () => {
      stop = true;
      readProvider.off('block', onBlock);
    };
  }, [dep, pullEvents, refreshReads]);

  useEffect(() => {
    refreshReads();
  }, [wallet.address, refreshReads]);

  // ---------- кошелёк ----------
  useEffect(() => {
    if (!eth?.on) return;
    const onAccounts = (accs) => {
      if (!accs.length) {
        setWallet({ status: 'disconnected', address: null, chainId: null });
        setRoles(null);
        log({ category: 'app', event: 'wallet.disconnected_by_wallet' });
      } else {
        setWallet((w) => (w.status === 'connected' ? { ...w, address: getAddress(accs[0]) } : w));
        log({ category: 'app', event: 'wallet.account_changed', account: accs[0] });
      }
    };
    const onChain = (hex) => {
      browserProviderRef.current = new BrowserProvider(eth, 'any');
      setWallet((w) => ({ ...w, chainId: BigInt(hex) }));
      log({ category: 'app', event: 'wallet.chain_changed', chainId: BigInt(hex).toString() });
    };
    eth.on('accountsChanged', onAccounts);
    eth.on('chainChanged', onChain);
    return () => {
      eth.removeListener?.('accountsChanged', onAccounts);
      eth.removeListener?.('chainChanged', onChain);
    };
  }, [eth, log]);

  async function connect() {
    const correlationId = newCorrelationId();
    if (!eth) {
      log({ category: 'app', event: 'wallet.missing', correlationId });
      setTx({ stage: Stage.ERROR, error: { kind: ErrorKind.UNKNOWN, message: 'Кошелёк не найден: установите MetaMask' } });
      return;
    }
    setWallet((w) => ({ ...w, status: 'connecting' }));
    try {
      const address = await requestAccount(eth);
      const chainId = await readChainId(eth);
      browserProviderRef.current = new BrowserProvider(eth, 'any');
      setWallet({ status: 'connected', address, chainId });
      log({ category: 'app', event: 'wallet.connected', correlationId, account: address, chainId: chainId.toString() });
    } catch (e) {
      const d = decodeError(e);
      setWallet({ status: 'disconnected', address: null, chainId: null });
      log({ category: 'app', event: 'wallet.connect_failed', correlationId, kind: d.kind, name: d.name });
      setTx({ stage: Stage.ERROR, error: { kind: d.kind, name: d.name, message: d.message } });
    }
  }

  async function disconnect() {
    const revoked = eth ? await revokeSession(eth) : false;
    browserProviderRef.current = null;
    log({ category: 'app', event: 'wallet.session_ended', account: wallet.address, permissionsRevoked: revoked });
    setWallet({ status: 'disconnected', address: null, chainId: null });
    setRoles(null);
    setTx({ stage: null });
  }

  async function switchNetwork() {
    try {
      await switchToAnvil(eth);
    } catch (e) {
      const d = decodeError(e);
      setTx({ stage: Stage.ERROR, error: { kind: d.kind, name: d.name, message: d.message } });
    }
  }

  // ---------- отправка транзакций ----------
  const [busy, setBusy] = useState(false);
  const [skipPreflight, setSkipPreflight] = useState(false);

  async function run(method, title, fn) {
    if (busy) return;
    const correlationId = newCorrelationId();
    setBusy(true);
    setTx({ stage: Stage.CHECKING, method, title, correlationId, history: [Stage.CHECKING] });
    try {
      const signer = await browserProviderRef.current.getSigner(wallet.address);
      const client = reader.withSigner(signer);
      const opts = {
        correlationId,
        skipPreflight,
        gasLimit: skipPreflight ? 200_000 : undefined,
        onStage: (stage, info) =>
          setTx((t) => ({ ...t, stage: stage === Stage.ERROR ? t.stage : stage, history: [...(t.history ?? []), stage], hash: info.txHash ?? t.hash, nonce: info.nonce ?? t.nonce })),
      };
      const r = await fn(client, opts);
      setTx((t) => ({ ...t, stage: Stage.SUCCESS, hash: r.hash, blockNumber: r.receipt.blockNumber, gasUsed: r.receipt.gasUsed.toString(), events: r.events.map((e) => e.name) }));
      // событие своей транзакции показываем сразу, не дожидаясь опроса блоков (дубль потом отбросит EventFeed)
      await pullEvents(Math.max(dep.deployBlock, r.receipt.blockNumber - 1), r.receipt.blockNumber).catch(() => {});
    } catch (e) {
      const d = decodeError(e);
      // поля перечисляем явно: message у Error неперечисляемый и потерялся бы при {...d}
      const error = { kind: d.kind, name: d.name, args: d.args, message: d.message, phase: e.phase, blockNumber: e.blockNumber, gasUsed: e.gasUsed };
      setTx((t) => ({ ...t, stage: Stage.ERROR, failedAt: t.stage, error, hash: e.txHash ?? t.hash }));
    } finally {
      setBusy(false);
      refreshReads();
    }
  }

  // ---------- формы ----------
  const [machine, setMachine] = useState('CNC-07');
  const [lookup, setLookup] = useState(null);
  const [verifyRes, setVerifyRes] = useState(null);
  const [regForm, setRegForm] = useState({ machineId: 'CNC-07', serviceCode: 101, documentHash: null, fileName: '' });
  const [grantTo, setGrantTo] = useState('');

  async function doLookup() {
    try {
      const [last, count] = await Promise.all([reader.getLastService(machine), reader.serviceCount(machine)]);
      setLookup({ ...last, count: count.toString() });
    } catch (e) {
      setLookup({ error: decodeError(e).message });
    }
  }
  async function doVerify(file) {
    if (!file) return;
    const h = await fileHash(file);
    const ok = await reader.verifyDocument(machine, h);
    setVerifyRes({ file: file.name, hash: h, ok });
  }

  const canWrite = wallet.status === 'connected' && !wrongNetwork && !!reader && !busy;
  const roleBadge = (on, label) => <span className={on ? 'badge on' : 'badge off'}>{label}</span>;

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>MaintenanceRegistry · реестр ТО оборудования</h1>
          <p className="sub">ПР №5, вариант 8 «Промышленность» · React + ethers.js v6 · контракт {dep ? <code title={dep.address}>{shortAddr(dep.address)}</code> : '—'}</p>
        </div>
        <div className="wallet">
          {wallet.status === 'connected' ? (
            <>
              <div className="kv">
                <span>Адрес</span>
                <code title={wallet.address}>{wallet.address}</code>
              </div>
              <div className="kv">
                <span>chainId</span>
                <code className={wrongNetwork ? 'bad' : 'good'}>
                  {wallet.chainId?.toString()} {wrongNetwork ? '(нужен 31337)' : '(Anvil)'}
                </code>
              </div>
              <button className="ghost" onClick={disconnect}>
                Завершить сеанс
              </button>
            </>
          ) : (
            <button onClick={connect} disabled={wallet.status === 'connecting'}>
              {wallet.status === 'connecting' ? 'Подтвердите в кошельке…' : 'Подключить кошелёк'}
            </button>
          )}
        </div>
      </header>

      {depError && <div className="banner bad">{depError}</div>}
      {!eth && <div className="banner bad">Кошелёк (EIP-1193) не найден в браузере: установите MetaMask.</div>}
      {wrongNetwork && (
        <div className="banner bad">
          Неверная сеть: кошелёк в chainId {wallet.chainId.toString()}, контракт развёрнут в 31337 (Anvil). Запись заблокирована.
          <button onClick={switchNetwork}>Переключить на Anvil</button>
        </div>
      )}

      <section className="grid">
        <div className="card">
          <h2>Состояние контракта (чтение)</h2>
          <div className="stats">
            <div>
              <b>{stats.total ?? '…'}</b>
              <span>totalRecords()</span>
            </div>
            <div>
              <b className={stats.paused ? 'bad' : 'good'}>{stats.paused === null ? '…' : stats.paused ? 'на паузе' : 'работает'}</b>
              <span>paused()</span>
            </div>
            <div>
              <b>{stats.block ?? '…'}</b>
              <span>текущий блок</span>
            </div>
          </div>
          <div className="roles">
            Ваши роли (hasRole):{' '}
            {roles ? (
              <>
                {roleBadge(roles.defaultAdmin, 'DEFAULT_ADMIN')} {roleBadge(roles.admin, 'ADMIN')} {roleBadge(roles.technician, 'TECHNICIAN')}
              </>
            ) : (
              <i>подключите кошелёк</i>
            )}
          </div>
          <div className="row">
            <input value={machine} onChange={(e) => setMachine(e.target.value)} placeholder="ID станка, напр. CNC-07" />
            <button className="ghost" onClick={doLookup} disabled={!reader}>
              getLastService()
            </button>
          </div>
          {lookup &&
            (lookup.error ? (
              <p className="bad">{lookup.error}</p>
            ) : lookup.exists ? (
              <table className="kvtable">
                <tbody>
                  <tr><td>Этап</td><td>{serviceLabel(lookup.serviceCode)} (код {lookup.serviceCode})</td></tr>
                  <tr><td>Время этапа</td><td>{new Date(lookup.timestamp * 1000).toLocaleString('ru-RU')}</td></tr>
                  <tr><td>Инженер</td><td><code>{lookup.technician}</code></td></tr>
                  <tr><td>Хеш акта</td><td><code>{shortHash(lookup.documentHash)}</code></td></tr>
                  <tr><td>Статус</td><td className={lookup.revoked ? 'bad' : 'good'}>{lookup.revoked ? 'отозвана' : 'действует'}</td></tr>
                  <tr><td>serviceCount()</td><td>{lookup.count}</td></tr>
                </tbody>
              </table>
            ) : (
              <p className="muted">Для станка {lookup.machineId} записей нет (serviceCount = {lookup.count}).</p>
            ))}
          <label className="file">
            verifyDocument(): выберите файл акта ТО
            <input type="file" onChange={(e) => doVerify(e.target.files?.[0])} disabled={!reader} />
          </label>
          {verifyRes && (
            <p className={verifyRes.ok ? 'good' : 'bad'}>
              {verifyRes.file}: keccak256 = <code>{shortHash(verifyRes.hash)}</code> — {verifyRes.ok ? 'совпадает с записью' : 'НЕ совпадает или запись отозвана'}
            </p>
          )}
        </div>

        <div className="card">
          <h2>Изменение состояния (подпись кошельком)</h2>
          <fieldset disabled={!canWrite}>
            <h3>registerService · роль TECHNICIAN</h3>
            <div className="row">
              <input value={regForm.machineId} onChange={(e) => setRegForm({ ...regForm, machineId: e.target.value })} placeholder="ID станка" />
              <select value={regForm.serviceCode} onChange={(e) => setRegForm({ ...regForm, serviceCode: Number(e.target.value) })}>
                {SERVICE_CODES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code} — {s.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="file">
              Акт ТО (хранится off-chain, в контракт уходит только keccak256)
              <input type="file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRegForm({ ...regForm, documentHash: await fileHash(f), fileName: f.name }); }} />
            </label>
            {regForm.documentHash && <p className="muted">{regForm.fileName}: <code>{shortHash(regForm.documentHash)}</code></p>}
            <button
              onClick={() =>
                run('registerService', 'Регистрация этапа ТО', async (c, o) => {
                  const ts = (await readProvider.getBlock('latest')).timestamp; // время узла, а не часов браузера
                  return c.registerService({ machineId: regForm.machineId, serviceCode: regForm.serviceCode, timestamp: ts, documentHash: regForm.documentHash ?? '0x' + '0'.repeat(64) }, o);
                })
              }
            >
              Зарегистрировать этап ТО
            </button>

            <h3>Администрирование · роль ADMIN</h3>
            <div className="row">
              <input value={machine} onChange={(e) => setMachine(e.target.value)} />
              <button onClick={() => run('revokeLastService', `Отзыв записи ${machine}`, (c, o) => c.revokeLastService(machine, o))}>revokeLastService</button>
            </div>
            <div className="row">
              <button onClick={() => run('pause', 'Пауза системы', (c, o) => c.pause(o))}>pause()</button>
              <button onClick={() => run('unpause', 'Снятие паузы', (c, o) => c.unpause(o))}>unpause()</button>
            </div>
            <div className="row">
              <input value={grantTo} onChange={(e) => setGrantTo(e.target.value)} placeholder="0x… адрес инженера" />
              <button disabled={!isAddress(grantTo)} onClick={() => run('grantRole', 'Выдача роли TECHNICIAN', (c, o) => c.grantTechnician(getAddress(grantTo), o))}>
                grantRole(TECHNICIAN)
              </button>
            </div>
            <label className="check">
              <input type="checkbox" checked={skipPreflight} onChange={(e) => setSkipPreflight(e.target.checked)} />
              Отправить без предварительной проверки (gasLimit 200000) — для демонстрации отката в блоке
            </label>
          </fieldset>
          <p className="muted small">
            Кнопки не скрываются по ролям намеренно: интерфейс лишь подсказывает, а решение о доступе принимает контракт (onlyRole). Без роли вызов откатится.
          </p>
        </div>

        <div className="card wide">
          <h2>Ход транзакции {tx.title ? `· ${tx.title}` : ''}</h2>
          {!tx.stage ? (
            <p className="muted">Транзакций в этом сеансе ещё не было.</p>
          ) : (
            <>
              <ol className="stepper">
                {STEPS.map((s) => {
                  const reached = tx.history?.includes(s);
                  const failedHere = tx.stage === Stage.ERROR && tx.failedAt === s;
                  const current = tx.stage === s && busy;
                  return (
                    <li key={s} className={failedHere ? 'fail' : current ? 'current' : reached ? 'done' : ''}>
                      {STAGE_LABELS[s]}
                    </li>
                  );
                })}
                <li className={tx.stage === Stage.SUCCESS ? 'ok' : tx.stage === Stage.ERROR ? 'fail' : ''}>
                  {tx.stage === Stage.ERROR ? 'Ошибка' : 'Успех'}
                </li>
              </ol>
              <table className="kvtable">
                <tbody>
                  <tr><td>Функция</td><td><code>{tx.method}</code></td></tr>
                  <tr><td>correlationId</td><td><code>{tx.correlationId}</code></td></tr>
                  {tx.hash && <tr><td>Хеш транзакции</td><td><code>{tx.hash}</code></td></tr>}
                  {tx.nonce !== undefined && <tr><td>nonce</td><td>{tx.nonce}</td></tr>}
                  {tx.blockNumber && <tr><td>Блок</td><td>{tx.blockNumber} (status 1)</td></tr>}
                  {tx.gasUsed && <tr><td>gasUsed</td><td>{tx.gasUsed}</td></tr>}
                  {tx.events && <tr><td>События</td><td>{tx.events.join(', ') || '—'}</td></tr>}
                </tbody>
              </table>
              {tx.stage === Stage.ERROR && tx.error && (
                <div className="errbox">
                  <b>{errorTitle(tx.error)}</b>
                  <div>{tx.error.message}</div>
                  {tx.error.name && <div className="muted small">ошибка: {tx.error.name} · вид: {tx.error.kind}{tx.error.phase ? ` · этап: ${tx.error.phase}` : ''}</div>}
                  {tx.error.phase === 'onchain' && <div className="muted small">Транзакция включена в блок {tx.error.blockNumber} со status 0, газ потрачен ({tx.error.gasUsed}); событий в журнале нет — причина восстановлена по квитанции.</div>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="card wide">
          <h2>
            События контракта <span className="muted small">уникальных {feedStats.unique} · дублей отброшено {feedStats.duplicates}</span>
          </h2>
          <div className="row">
            <button className="ghost" disabled={!dep} onClick={() => pullEvents(dep.deployBlock, 'latest', 'Повторная загрузка истории')}>
              Перечитать историю (проверка дедупликации)
            </button>
            <span className="muted small">{feedStats.note}</span>
          </div>
          <table className="events">
            <thead>
              <tr><th>Блок</th><th>Событие</th><th>Описание</th><th>Транзакция #лог</th></tr>
            </thead>
            <tbody>
              {events.slice(0, 25).map((e) => (
                <tr key={e.key}>
                  <td>{e.blockNumber}</td>
                  <td><span className={`ev ${e.name}`}>{e.name}</span></td>
                  <td>{e.text}</td>
                  <td><code title={e.txHash}>{shortHash(e.txHash)}</code> #{e.logIndex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card wide">
          <h2>
            Прикладной журнал (телеметрия){' '}
            <span className={`small ${collectorOk === false ? 'bad' : collectorOk ? 'good' : 'muted'}`}>
              коллектор {TELEMETRY_URL}: {collectorOk === null ? 'нет данных' : collectorOk ? 'принимает' : 'недоступен'}
            </span>
          </h2>
          <table className="events">
            <thead>
              <tr><th>Время (UTC)</th><th>Категория</th><th>Событие</th><th>Детали</th><th>correlationId</th></tr>
            </thead>
            <tbody>
              {appLog.map((r, i) => (
                <tr key={i}>
                  <td>{r.ts.slice(11, 23)}</td>
                  <td>{r.category}</td>
                  <td>{r.event}</td>
                  <td>{[r.method, r.name, r.txHash && shortHash(r.txHash)].filter(Boolean).join(' · ')}</td>
                  <td><code>{r.correlationId ? String(r.correlationId).slice(0, 8) : '—'}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
