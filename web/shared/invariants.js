import { Contract } from 'ethers';
import { REGISTRY_ABI } from './abi.js';
import { ROLES, bytes32ToMachineId } from './config.js';

/**
 * Проверка трёх инвариантов безопасности по ДАННЫМ РАЗВЁРНУТОГО контракта
 * (журнал событий + исторические состояния через blockTag).
 *
 *  I1 Авторизация: каждое изменение сделано адресом, у которого в том блоке была нужная роль
 *     (ServiceRegistered — TECHNICIAN_ROLE; ServiceRevoked, Paused, Unpaused — ADMIN_ROLE).
 *  I2 Целостность учёта: totalRecords = число событий ServiceRegistered = Σ serviceCount(станок).
 *  I3 Пауза блокирует запись: между Paused и Unpaused нет ни одного ServiceRegistered.
 *
 * @returns {Promise<{I1:{ok:boolean,details:string[]},I2:{ok:boolean,details:string[]},I3:{ok:boolean,details:string[]}, events:number, block:number}>}
 */
export async function checkInvariants(provider, address, fromBlock = 0) {
  const c = new Contract(address, REGISTRY_ABI, provider);
  const block = await provider.getBlockNumber();
  const logs = (await c.queryFilter('*', fromBlock, block)).filter((l) => l.fragment);
  logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

  const res = { I1: { ok: true, details: [] }, I2: { ok: true, details: [] }, I3: { ok: true, details: [] }, events: logs.length, block };

  // I1 — роль у инициатора в момент изменения: hasRole на состоянии блока события
  // (на Anvil с automine одна транзакция = один блок, поэтому это и есть момент действия).
  for (const l of logs) {
    const name = l.fragment.name;
    let who = null;
    let role = null;
    if (name === 'ServiceRegistered') [who, role] = [l.args.technician, ROLES.TECHNICIAN_ROLE];
    else if (name === 'ServiceRevoked') [who, role] = [l.args.admin, ROLES.ADMIN_ROLE];
    else if (name === 'Paused' || name === 'Unpaused') [who, role] = [l.args.account, ROLES.ADMIN_ROLE];
    if (!who) continue;
    const had = await c.hasRole(role, who, { blockTag: l.blockNumber });
    if (!had) {
      res.I1.ok = false;
      res.I1.details.push(`${name} в блоке ${l.blockNumber} от ${who} без нужной роли (tx ${l.transactionHash})`);
    }
  }

  // I2 — счётчики.
  const regs = logs.filter((l) => l.fragment.name === 'ServiceRegistered');
  const machines = [...new Set(regs.map((l) => l.args.machineId))];
  const total = await c.totalRecords({ blockTag: block });
  let sum = 0n;
  for (const m of machines) sum += await c.serviceCount(m, { blockTag: block });
  const evCount = BigInt(regs.length);
  if (total !== evCount || total !== sum) {
    res.I2.ok = false;
    res.I2.details.push(`totalRecords=${total}, событий ServiceRegistered=${evCount}, Σ serviceCount=${sum}`);
  } else {
    res.I2.details.push(`totalRecords=${total} = событий ${evCount} = Σ serviceCount ${sum} (${machines.length} станков)`);
  }

  // I3 — пауза.
  let paused = false;
  for (const l of logs) {
    const n = l.fragment.name;
    if (n === 'Paused') paused = true;
    else if (n === 'Unpaused') paused = false;
    else if (n === 'ServiceRegistered' && paused) {
      res.I3.ok = false;
      res.I3.details.push(`регистрация станка ${bytes32ToMachineId(l.args.machineId)} на паузе, блок ${l.blockNumber}`);
    }
  }
  const pauses = logs.filter((l) => l.fragment.name === 'Paused').length;
  if (res.I3.ok) res.I3.details.push(`интервалов паузы: ${pauses}, регистраций на паузе: 0`);
  return res;
}
