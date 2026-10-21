// Сценарии для демонстрации мониторинга (Задание 3.3) без ручных кликов в браузере.
// Действуют как пользователи dApp: тот же клиентский слой (shared/registry.js), тот же прикладной
// журнал, отправка записей в коллектор монитора. Аккаунты — разблокированные тестовые аккаунты Anvil.
//
//   node scripts/scenario.mjs normal   штатная работа: регистрации, отзыв, один случайный отказ — тревог нет
//   node scripts/scenario.mjs attack   посторонний 2 раза получает отказ в dApp и 2 раза отправляет
//                                     транзакцию в обход проверки (status 0) — R1 срабатывает на 3-м сигнале
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, keccak256, toUtf8Bytes } from 'ethers';
import { RegistryClient } from '../shared/registry.js';
import { createTelemetry, newCorrelationId } from '../shared/telemetry.js';

const here = dirname(fileURLToPath(import.meta.url));
const dep = JSON.parse(readFileSync(resolve(here, '../public/deployment.json'), 'utf8'));
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const COLLECTOR = process.env.TELEMETRY_URL || 'http://localhost:8787/telemetry';
const mode = process.argv[2] || 'normal';

const provider = new JsonRpcProvider(RPC_URL, undefined, { staticNetwork: true, pollingInterval: 100, cacheTimeout: -1 });
const post = (rec) => fetch(COLLECTOR, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rec) }).catch(() => {});
const pending = [];
const log = createTelemetry({ source: 'dapp-scenario', sinks: [(r) => pending.push(post(r))] });

async function as(account) {
  return new RegistryClient({ address: dep.address, provider, signer: await provider.getSigner(account), log });
}
async function step(title, fn) {
  const cid = newCorrelationId();
  process.stdout.write(`• ${title} [cid ${cid.slice(0, 8)}] … `);
  try {
    const r = await fn(cid);
    console.log(`OK${r?.receipt ? `, блок ${r.receipt.blockNumber}, tx ${r.hash.slice(0, 12)}…` : ''}`);
  } catch (e) {
    console.log(`ОТКАЗ: ${e.name} (${e.phase})${e.blockNumber ? `, блок ${e.blockNumber}, status 0` : ''}`);
  }
  await new Promise((r) => setTimeout(r, 400));
}
const ts = async () => (await provider.getBlock('latest')).timestamp;
const doc = (s) => keccak256(toUtf8Bytes(s));

const { admin, technician, stranger } = dep.accounts;
if (mode === 'normal') {
  const t = await as(technician);
  const a = await as(admin);
  await step('инженер: плановое ТО CNC-07', async (cid) => t.registerService({ machineId: 'CNC-07', serviceCode: 101, timestamp: await ts(), documentHash: doc('Акт ТО CNC-07') }, { correlationId: cid }));
  await step('инженер: калибровка CMM-21', async (cid) => t.registerService({ machineId: 'CMM-21', serviceCode: 301, timestamp: await ts(), documentHash: doc('Акт калибровки CMM-21') }, { correlationId: cid }));
  await step('инженер: ремонт PRESS-02', async (cid) => t.registerService({ machineId: 'PRESS-02', serviceCode: 201, timestamp: await ts(), documentHash: doc('Акт ремонта PRESS-02') }, { correlationId: cid }));
  await step('админ: отзыв ошибочной записи PRESS-02', async (cid) => a.revokeLastService('PRESS-02', { correlationId: cid }));
  await step('инженер по ошибке нажимает «Пауза» (1 отказ < порога)', async (cid) => t.pause({ correlationId: cid }));
} else if (mode === 'attack') {
  const s = await as(stranger);
  await step('посторонний: регистрация ТО (отказ в dApp, eth_call)', async (cid) => s.registerService({ machineId: 'CNC-07', serviceCode: 101, timestamp: await ts(), documentHash: doc('фальшивый акт') }, { correlationId: cid }));
  await step('посторонний: пауза системы (отказ в dApp, eth_call)', async (cid) => s.pause({ correlationId: cid }));
  await step('посторонний: отзыв записи в обход проверки (gasLimit вручную)', async (cid) => s.revokeLastService('CNC-07', { correlationId: cid, skipPreflight: true, gasLimit: 120000 }));
  await step('посторонний: пауза в обход проверки (gasLimit вручную)', async (cid) => s.pause({ correlationId: cid, skipPreflight: true, gasLimit: 120000 }));
} else {
  console.error('режим: normal | attack');
  process.exit(1);
}
await Promise.all(pending);
provider.destroy();
