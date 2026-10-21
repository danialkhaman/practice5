// Нагрузочный эксперимент (Задание 3.5–3.6).
//
// Профили:
//   S — 30 последовательных транзакций, 1 клиент (следующая отправляется после квитанции предыдущей);
//   P — 30 транзакций суммарно, 5 параллельных клиентов по 6 транзакций (у каждого свой аккаунт и свой nonce);
//   Q — проверка предложенной оптимизации: 1 клиент, 30 транзакций конвейером (nonce, nonce+1, … без ожидания).
// Режимы узла (одинаковые для обоих профилей, свежий Anvil перед каждым прогоном):
//   blocktime1 — блок раз в 1 с (модель реальной сети с фиксированным интервалом блока) — основной;
//   automine   — блок на каждую транзакцию (контрольный: показывает накладные расходы клиента/RPC/EVM).
//
// Методика: задержка = от вызова eth_sendTransaction до получения квитанции (опрос eth_getTransactionReceipt
// каждые 10 мс). Подпись выполняет Anvil (разблокированные тестовые аккаунты) — время человека в кошельке
// исключено. gasLimit фиксирован (оценка один раз × 1.25), nonce ведётся локально для каждого клиента.
// Перед замером — по одной прогревочной транзакции на клиента (не учитывается).
//
// Запуск: npm run load   (нужен anvil в PATH и собранный контракт: cd ../contracts && forge build)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Contract, JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import { startAnvil } from '../scripts/anvil.mjs';
import { deployRegistry } from '../scripts/deploy.mjs';
import { REGISTRY_ABI } from '../shared/abi.js';
import { machineIdToBytes32 } from '../shared/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const TOTAL = Number(process.env.LOAD_TOTAL || 30);
const CLIENTS = Number(process.env.LOAD_CLIENTS || 5);
const PORT = Number(process.env.LOAD_PORT || 8565);
const MODES = (process.env.LOAD_MODES || 'blocktime1,automine').split(',');
const BLOCK_TIME = { blocktime1: 1, automine: 0 };
const RECEIPT_POLL_MS = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => {
  if (!sorted.length) return null;
  const rank = (p / 100) * (sorted.length - 1); // линейная интерполяция (как numpy.percentile по умолчанию)
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
};

async function waitReceipt(provider, hash) {
  for (;;) {
    const r = await provider.send('eth_getTransactionReceipt', [hash]);
    if (r) return r;
    await sleep(RECEIPT_POLL_MS);
  }
}

/** Один клиент: n транзакций подряд, nonce ведётся локально. */
async function client({ provider, contract, from, n, tag, gasLimit, ts, startNonce, results, t0 }) {
  let nonce = startNonce;
  for (let i = 0; i < n; i++) {
    const id = `${tag}-${String(i + 1).padStart(2, '0')}`;
    const data = contract.interface.encodeFunctionData('registerService', [machineIdToBytes32(id), 101, ts, keccak256(toUtf8Bytes(`act ${id}`))]);
    const rec = { profile: null, client: from, index: i + 1, machineId: id, nonce };
    const tSend = performance.now();
    try {
      const hash = await provider.send('eth_sendTransaction', [{ from, to: contract.target, data, gas: '0x' + gasLimit.toString(16), nonce: '0x' + nonce.toString(16) }]);
      nonce++;
      const tAccepted = performance.now();
      const r = await waitReceipt(provider, hash);
      const tReceipt = performance.now();
      Object.assign(rec, {
        txHash: hash,
        sendMs: +(tSend - t0).toFixed(2),
        submitMs: +(tAccepted - tSend).toFixed(2),
        latencyMs: +(tReceipt - tSend).toFixed(2),
        doneMs: +(tReceipt - t0).toFixed(2),
        blockNumber: Number(r.blockNumber),
        status: Number(r.status),
        gasUsed: Number(r.gasUsed),
        error: Number(r.status) === 1 ? '' : 'status 0',
      });
    } catch (e) {
      Object.assign(rec, { txHash: '', sendMs: +(tSend - t0).toFixed(2), latencyMs: null, doneMs: +(performance.now() - t0).toFixed(2), status: 0, gasUsed: 0, error: (e.shortMessage || e.message).slice(0, 120) });
    }
    results.push(rec);
  }
}

/** Конвейер (проверка меры оптимизации): n транзакций подряд с nonce, nonce+1, … без ожидания квитанций. */
async function pipelinedClient({ provider, contract, from, n, tag, gasLimit, ts, startNonce, results, t0 }) {
  const pending = [];
  for (let i = 0; i < n; i++) {
    const id = `${tag}-${String(i + 1).padStart(2, '0')}`;
    const nonce = startNonce + i;
    const data = contract.interface.encodeFunctionData('registerService', [machineIdToBytes32(id), 101, ts, keccak256(toUtf8Bytes(`act ${id}`))]);
    const tSend = performance.now();
    const hash = await provider.send('eth_sendTransaction', [{ from, to: contract.target, data, gas: '0x' + gasLimit.toString(16), nonce: '0x' + nonce.toString(16) }]);
    const tAccepted = performance.now();
    pending.push(
      waitReceipt(provider, hash).then((r) => {
        const tReceipt = performance.now();
        results.push({ profile: null, client: from, index: i + 1, machineId: id, nonce, txHash: hash, sendMs: +(tSend - t0).toFixed(2), submitMs: +(tAccepted - tSend).toFixed(2), latencyMs: +(tReceipt - tSend).toFixed(2), doneMs: +(tReceipt - t0).toFixed(2), blockNumber: Number(r.blockNumber), status: Number(r.status), gasUsed: Number(r.gasUsed), error: Number(r.status) === 1 ? '' : 'status 0' });
      }),
    );
  }
  await Promise.all(pending);
}

async function runOnce(mode, profile) {
  const anvil = await startAnvil({ port: PORT, blockTime: BLOCK_TIME[mode] });
  try {
    const dep = await deployRegistry({ rpcUrl: anvil.url, log: () => {} });
    const provider = new JsonRpcProvider(anvil.url, undefined, { staticNetwork: true, cacheTimeout: -1 });
    const contract = new Contract(dep.address, REGISTRY_ABI, provider);
    const clients = profile === 'P' ? dep.accounts.loadClients.slice(0, CLIENTS) : [dep.accounts.loadClients[0]];
    const perClient = TOTAL / clients.length;
    const ts = Number((await provider.getBlock('latest')).timestamp); // <= любого будущего block.timestamp

    // фиксированный gasLimit: одна оценка × 1.25
    const est = await provider.estimateGas({ from: clients[0], to: dep.address, data: contract.interface.encodeFunctionData('registerService', [machineIdToBytes32('WARM-EST'), 101, ts, keccak256('0x01')]) });
    const gasLimit = (est * 125n) / 100n;

    // прогрев: по одной транзакции на клиента (не учитывается)
    await Promise.all(
      clients.map(async (from, k) => {
        const n0 = await provider.getTransactionCount(from, 'pending');
        await client({ provider, contract, from, n: 1, tag: `WARM${profile}${k}`, gasLimit, ts, startNonce: n0, results: [], t0: 0 });
      }),
    );

    const startBlock = await provider.getBlockNumber();
    const results = [];
    const t0 = performance.now();
    await Promise.all(
      clients.map(async (from, k) => {
        const startNonce = await provider.getTransactionCount(from, 'pending');
        const run = profile === 'Q' ? pipelinedClient : client;
        await run({ provider, contract, from, n: perClient, tag: `L${profile}${k + 1}`, gasLimit, ts, startNonce, results, t0 });
      }),
    );
    const wallMs = performance.now() - t0;
    const endBlock = await provider.getBlockNumber();
    provider.destroy();
    for (const r of results) r.profile = profile;

    const ok = results.filter((r) => r.status === 1);
    const lat = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
    const gas = ok.map((r) => r.gasUsed);
    const blocks = new Map();
    for (const r of ok) blocks.set(r.blockNumber, (blocks.get(r.blockNumber) ?? 0) + 1);
    const firstSend = Math.min(...results.map((r) => r.sendMs));
    const lastDone = Math.max(...results.map((r) => r.doneMs));
    const summary = {
      mode,
      profile,
      clients: clients.length,
      total: results.length,
      success: ok.length,
      failed: results.length - ok.length,
      failRatePct: +((100 * (results.length - ok.length)) / results.length).toFixed(2),
      p50Ms: +pct(lat, 50).toFixed(1),
      p95Ms: +pct(lat, 95).toFixed(1),
      minMs: +lat[0].toFixed(1),
      maxMs: +lat.at(-1).toFixed(1),
      meanMs: +(lat.reduce((s, x) => s + x, 0) / lat.length).toFixed(1),
      wallMs: +wallMs.toFixed(1),
      throughputOps: +(ok.length / ((lastDone - firstSend) / 1000)).toFixed(2),
      gasUsedMin: Math.min(...gas),
      gasUsedMax: Math.max(...gas),
      gasUsedAvg: Math.round(gas.reduce((s, x) => s + x, 0) / gas.length),
      gasUsedTotal: gas.reduce((s, x) => s + x, 0),
      gasLimit: Number(gasLimit),
      blocksUsed: blocks.size,
      txPerBlockMax: Math.max(...blocks.values()),
      blockRange: [startBlock + 1, endBlock],
    };
    return { summary, results };
  } finally {
    await anvil.stop();
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(here, 'results', stamp);
mkdirSync(outDir, { recursive: true });
const summaries = [];
const PROFILE_TITLE = { S: 'S: 30 последовательных', P: 'P: 5 параллельных × 6', Q: 'Q: конвейер 30 без ожидания (оптимизация)' };
for (const mode of MODES) {
  // Q — дополнительный прогон для проверки предложенной оптимизации (только в основном режиме)
  const profiles = mode === 'blocktime1' && process.env.LOAD_PIPELINE !== '0' ? ['S', 'P', 'Q'] : ['S', 'P'];
  for (const profile of profiles) {
    process.stdout.write(`прогон ${mode}/${profile} … `);
    const { summary, results } = await runOnce(mode, profile);
    summaries.push(summary);
    const cols = ['profile', 'client', 'index', 'machineId', 'nonce', 'txHash', 'sendMs', 'submitMs', 'latencyMs', 'doneMs', 'blockNumber', 'status', 'gasUsed', 'error'];
    writeFileSync(resolve(outDir, `raw-${mode}-${profile}.csv`), [cols.join(','), ...results.sort((a, b) => a.sendMs - b.sendMs).map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n');
    console.log(`p50 ${summary.p50Ms} мс, p95 ${summary.p95Ms} мс, ${summary.throughputOps} оп/с, ошибок ${summary.failRatePct}%, gasUsed ср. ${summary.gasUsedAvg}`);
  }
}
writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify({ when: new Date().toISOString(), node: process.version, total: TOTAL, clients: CLIENTS, receiptPollMs: RECEIPT_POLL_MS, summaries }, null, 2));
const md = [
  '| Режим узла | Профиль | Клиентов | Успешно/всего | Доля неуспешных | p50, мс | p95, мс | Пропускная способность, оп/с | gasUsed ср. (min–max) | Блоков | Макс. tx в блоке |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
  ...summaries.map((s) => `| ${s.mode} | ${PROFILE_TITLE[s.profile]} | ${s.clients} | ${s.success}/${s.total} | ${s.failRatePct}% | ${s.p50Ms} | ${s.p95Ms} | ${s.throughputOps} | ${s.gasUsedAvg} (${s.gasUsedMin}–${s.gasUsedMax}) | ${s.blocksUsed} | ${s.txPerBlockMax} |`),
].join('\n');
writeFileSync(resolve(outDir, 'summary.md'), md + '\n');
console.log(`\n${md}\n\nРезультаты: ${outDir}`);
