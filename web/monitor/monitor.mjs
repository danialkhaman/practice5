// Прототип мониторинга безопасности (Задание 3.1–3.3).
// Источники телеметрии:
//   1) event   — события контракта (журналы EVM успешных транзакций);
//   2) receipt — квитанции ВСЕХ транзакций к контракту, включая status = 0 (их события в журнал не попадают);
//   3) rpc     — ошибки и таймауты RPC-запросов монитора, восстановление узла;
//   4) app     — прикладной журнал dApp (этапы транзакций, отказы предварительной проверки), приходит по HTTP.
// Каждая запись: ts (UTC ISO-8601) + correlationId. Секреты не логируются (shared/telemetry.js: redact).
//
// Запуск:  npm run monitor        (переменные окружения — см. .env.example)
import http from 'node:http';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchRequest, JsonRpcProvider, Interface } from 'ethers';
import { REGISTRY_ABI } from '../shared/abi.js';
import { createTelemetry } from '../shared/telemetry.js';
import { decodeFailedReceipt } from '../shared/registry.js';
import { checkInvariants } from '../shared/invariants.js';
import { Detector, RULES } from './rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = {
  rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
  port: Number(process.env.COLLECTOR_PORT || 8787),
  pollMs: Number(process.env.POLL_MS || 1000),
  rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS || 3000),
  logDir: resolve(here, process.env.LOG_DIR || 'logs'),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','),
  webhook: process.env.ALERT_WEBHOOK_URL || '',
};
const deploymentFile = resolve(here, '../public/deployment.json');
let address = process.env.CONTRACT_ADDRESS;
let deployBlock = 0;
if (!address && existsSync(deploymentFile)) {
  const d = JSON.parse(readFileSync(deploymentFile, 'utf8'));
  address = d.address;
  deployBlock = d.deployBlock ?? 0;
}
if (!address) {
  console.error('Не задан адрес контракта: выполните npm run deploy:local или задайте CONTRACT_ADDRESS');
  process.exit(1);
}

mkdirSync(cfg.logDir, { recursive: true });
const TELEMETRY_FILE = resolve(cfg.logDir, 'telemetry.jsonl');
const ALERTS_FILE = resolve(cfg.logDir, 'alerts.jsonl');

// ---------- журналы ----------
const C = { red: '\x1b[31m', yel: '\x1b[33m', grn: '\x1b[32m', dim: '\x1b[2m', rst: '\x1b[0m', bold: '\x1b[1m' };
const writeJsonl = (file) => (rec) => appendFileSync(file, JSON.stringify(rec) + '\n');
const consoleSink = (rec) => {
  const t = rec.ts.slice(11, 23);
  const cid = rec.correlationId ? ` cid=${String(rec.correlationId).slice(0, 8)}` : '';
  if (rec.category === 'receipt') {
    const st = rec.status === 1 ? `${C.grn}status=1${C.rst}` : `${C.red}status=0 ${rec.error?.name ?? ''}${C.rst}`;
    console.log(`${C.dim}${t}${C.rst} [receipt] блок ${rec.blockNumber} ${rec.method} from=${rec.from.slice(0, 8)} ${st} gas=${rec.gasUsed}${cid}`);
  } else if (rec.category === 'event') {
    console.log(`${C.dim}${t}${C.rst} [event]   блок ${rec.blockNumber} ${rec.name} tx=${rec.txHash.slice(0, 10)}#${rec.logIndex}${cid}`);
  } else if (rec.category === 'rpc') {
    const col = rec.event === 'rpc.error' ? C.yel : C.grn;
    console.log(`${C.dim}${t}${C.rst} [rpc]     ${col}${rec.event}${C.rst} ${rec.method ?? ''} ${rec.code ?? ''} ${rec.message ?? ''}`);
  } else if (rec.category === 'app') {
    console.log(`${C.dim}${t}${C.rst} [app]     ${rec.event} ${rec.method ?? ''} ${rec.name ?? ''} ${rec.txHash ? 'tx=' + rec.txHash.slice(0, 10) : ''}${cid}`);
  } else if (rec.category === 'invariant') {
    console.log(`${C.dim}${t}${C.rst} [inv]     I1=${rec.I1} I2=${rec.I2} I3=${rec.I3} (событий ${rec.events}, блок ${rec.block})`);
  }
};
const tlog = createTelemetry({ source: 'monitor', sinks: [writeJsonl(TELEMETRY_FILE), consoleSink] });

async function deliverAlert(a) {
  appendFileSync(ALERTS_FILE, JSON.stringify(a) + '\n');
  if (a.event === 'alert.resolved') {
    console.log(`\n${C.grn}${C.bold}✔ RESOLVED ${a.ruleId} «${a.rule}»: ${a.subject}, простой ${a.downtimeMs} мс, подавлено повторов: ${a.suppressedDuringIncident}${C.rst}\n`);
  } else {
    const col = a.severity === 'HIGH' ? C.red : C.yel;
    console.log(
      `\n${col}${C.bold}🚨 ALERT ${a.alertId} [${a.severity}] ${a.ruleId} «${a.rule}»${C.rst}\n` +
        `   субъект: ${a.subject}\n   сигналов: ${a.count} (порог ${a.threshold} за ${a.windowSec} с), с ${a.firstSeen} по ${a.lastSeen}\n` +
        `   доказательство: ${a.evidence}\n   реакция: ${a.reaction}\n   повторные уведомления подавляются ${RULES[a.ruleId].cooldownSec} с\n`,
    );
  }
  if (cfg.webhook) {
    try {
      await fetch(cfg.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) });
    } catch (e) {
      console.log(`${C.yel}webhook недоступен: ${e.message}${C.rst}`);
    }
  }
}
const detector = new Detector({
  onAlert: (a) => void deliverAlert(a),
  onSuppress: (x) => {
    appendFileSync(TELEMETRY_FILE, JSON.stringify(x) + '\n');
    console.log(`${C.dim}${x.ts.slice(11, 23)} [alert]   повтор ${x.ruleId} по ${x.subject.slice(0, 10)} подавлен (тревога ${x.alertId}, подавлено ${x.suppressed}, до повторной отправки ${x.cooldownLeftSec} с)${C.rst}`);
  },
});
const ingest = (rec) => detector.ingest(tlog(rec));

// ---------- RPC с таймаутом ----------
const req = new FetchRequest(cfg.rpcUrl);
req.timeout = cfg.rpcTimeoutMs;
const provider = new JsonRpcProvider(req, undefined, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
const iface = new Interface(REGISTRY_ABI);
let rpcDownSince = null;

async function rpc(method, fn) {
  const t0 = Date.now();
  try {
    const v = await fn();
    if (rpcDownSince) {
      ingest({ category: 'rpc', event: 'rpc.recovered', endpoint: cfg.rpcUrl, method, downtimeMs: Date.now() - rpcDownSince });
      rpcDownSince = null;
    }
    return v;
  } catch (e) {
    rpcDownSince ??= t0;
    ingest({
      category: 'rpc',
      event: 'rpc.error',
      endpoint: cfg.rpcUrl,
      method,
      code: e.code ?? e.cause?.code ?? 'ERR',
      message: (e.shortMessage || e.message || '').slice(0, 160),
      latencyMs: Date.now() - t0,
    });
    return undefined;
  }
}

// ---------- сбор квитанций и событий ----------
const cidByTx = new Map(); // txHash -> correlationId из прикладного журнала dApp
let lastBlock = null;

async function processBlock(n) {
  const block = await rpc('eth_getBlockByNumber', () => provider.getBlock(n, true));
  if (!block) return false;
  for (const tx of block.prefetchedTransactions) {
    if (!tx.to || tx.to.toLowerCase() !== address.toLowerCase()) continue;
    const receipt = await rpc('eth_getTransactionReceipt', () => provider.getTransactionReceipt(tx.hash));
    if (!receipt) return false;
    let method = 'unknown';
    try {
      method = iface.parseTransaction({ data: tx.data })?.name ?? 'unknown';
    } catch {}
    const correlationId = cidByTx.get(tx.hash.toLowerCase()) ?? `tx:${tx.hash.slice(0, 18)}`;
    const rec = {
      category: 'receipt',
      event: receipt.status === 1 ? 'tx.mined' : 'tx.reverted',
      correlationId,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      from: tx.from,
      method,
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      nonce: tx.nonce,
    };
    if (receipt.status === 0) rec.error = await decodeFailedReceipt(provider, tx, receipt);
    ingest(rec);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== address.toLowerCase()) continue;
      try {
        const p = iface.parseLog(log);
        const args = {};
        p.fragment.inputs.forEach((inp, i) => (args[inp.name] = typeof p.args[i] === 'bigint' ? p.args[i].toString() : p.args[i]));
        ingest({ category: 'event', event: 'contract.event', correlationId, name: p.name, args, txHash: log.transactionHash, logIndex: log.index, blockNumber: log.blockNumber });
      } catch {}
    }
  }
  return true;
}

async function pollLoop() {
  for (;;) {
    const head = await rpc('eth_blockNumber', () => provider.getBlockNumber());
    if (head !== undefined) {
      if (lastBlock === null) lastBlock = Math.max(deployBlock - 1, head - 50);
      while (lastBlock < head) {
        if (!(await processBlock(lastBlock + 1))) break; // ошибка RPC — повторим на следующем цикле
        lastBlock++;
      }
    }
    await new Promise((r) => setTimeout(r, cfg.pollMs));
  }
}

// ---------- HTTP-коллектор прикладного журнала ----------
function cors(reqH, res) {
  const origin = reqH.headers.origin;
  if (origin && cfg.allowedOrigins.includes(origin)) res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'POST, GET, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}
const server = http.createServer(async (rq, res) => {
  cors(rq, res);
  if (rq.method === 'OPTIONS') return res.writeHead(204).end();
  if (rq.method === 'GET' && rq.url === '/health') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, lastBlock, address }));
  if (rq.method === 'GET' && rq.url === '/alerts') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(detector.alerts.slice(-50)));
  if (rq.method === 'GET' && rq.url === '/invariants') {
    try {
      const r = await checkInvariants(provider, address, deployBlock);
      const rec = tlog({ category: 'invariant', event: 'invariants.checked', I1: r.I1.ok, I2: r.I2.ok, I3: r.I3.ok, events: r.events, block: r.block, details: { I1: r.I1.details, I2: r.I2.details, I3: r.I3.details } });
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(rec));
    } catch (e) {
      return res.writeHead(502).end(e.message);
    }
  }
  if (rq.method === 'POST' && rq.url === '/telemetry') {
    let body = '';
    for await (const chunk of rq) {
      body += chunk;
      if (body.length > 64 * 1024) return res.writeHead(413).end();
    }
    try {
      const items = [].concat(JSON.parse(body)).slice(0, 50);
      for (const it of items) {
        if (!['app', 'rpc'].includes(it.category)) continue; // браузер может присылать только прикладные записи
        if (it.txHash && it.correlationId) cidByTx.set(String(it.txHash).toLowerCase(), it.correlationId);
        ingest({ ...it, source: 'dapp', receivedAt: new Date().toISOString(), ts: new Date().toISOString(), clientTs: it.ts });
      }
      return res.writeHead(204).end();
    } catch {
      return res.writeHead(400).end();
    }
  }
  res.writeHead(404).end();
});

server.listen(cfg.port, '0.0.0.0', () => {
  console.log(`${C.bold}Монитор MaintenanceRegistry${C.rst}: контракт ${address}, RPC ${cfg.rpcUrl}, опрос ${cfg.pollMs} мс, таймаут RPC ${cfg.rpcTimeoutMs} мс`);
  console.log(`Коллектор журнала dApp: http://localhost:${cfg.port}/telemetry · журналы: ${TELEMETRY_FILE}, ${ALERTS_FILE}`);
  for (const r of Object.values(RULES)) console.log(`  ${r.id} «${r.name}»: порог ${r.threshold} за ${r.windowSec} с, ${r.severity}, повтор не чаще 1 раза в ${r.cooldownSec} с`);
  console.log('');
  pollLoop();
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  console.log(`\nОстановлено. Тревог: ${detector.alerts.filter((a) => a.event === 'alert.fired').length}, подавлено повторов: ${detector.suppressed}`);
  process.exit(0);
});
