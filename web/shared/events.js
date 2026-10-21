import { Contract } from 'ethers';
import { REGISTRY_ABI } from './abi.js';
import { bytes32ToMachineId, roleName, serviceLabel, shortAddr } from './config.js';

// Отображаемые типы событий (Задание 1.4: не менее двух).
export const WATCHED_EVENTS = ['ServiceRegistered', 'ServiceRevoked', 'Paused', 'Unpaused', 'RoleGranted', 'RoleRevoked'];

export function describeEvent(name, a) {
  switch (name) {
    case 'ServiceRegistered':
      return `станок ${bytes32ToMachineId(a.machineId)}: ${serviceLabel(a.serviceCode)} (код ${a.serviceCode}), инженер ${shortAddr(a.technician)}`;
    case 'ServiceRevoked':
      return `станок ${bytes32ToMachineId(a.machineId)}: запись отозвана, админ ${shortAddr(a.admin)}`;
    case 'Paused':
      return `пауза включена (${shortAddr(a.account)})`;
    case 'Unpaused':
      return `пауза снята (${shortAddr(a.account)})`;
    case 'RoleGranted':
      return `${roleName(a.role)} → ${shortAddr(a.account)} (выдал ${shortAddr(a.sender)})`;
    case 'RoleRevoked':
      return `${roleName(a.role)} отозвана у ${shortAddr(a.account)}`;
    default:
      return name;
  }
}

/**
 * Лента событий без дублей. Ключ уникальности — (txHash, logIndex): одно и то же
 * событие может прийти дважды (история + live-опрос, повторное подключение,
 * перекрытие диапазонов блоков) — второй раз оно отбрасывается.
 */
export class EventFeed {
  constructor() {
    this.items = new Map();
    this.duplicates = 0;
  }
  static key(log) {
    return `${log.transactionHash.toLowerCase()}:${log.index}`;
  }
  /** @returns {boolean} true — новое событие, false — дубль */
  add(evLog) {
    const key = EventFeed.key(evLog);
    if (this.items.has(key)) {
      this.duplicates++;
      return false;
    }
    const a = evLog.args;
    const args = {};
    evLog.fragment.inputs.forEach((inp, i) => {
      const v = a[i];
      args[inp.name] = typeof v === 'bigint' ? v.toString() : v;
    });
    this.items.set(key, {
      key,
      name: evLog.eventName ?? evLog.fragment.name,
      args,
      text: describeEvent(evLog.eventName ?? evLog.fragment.name, args),
      blockNumber: evLog.blockNumber,
      txHash: evLog.transactionHash,
      logIndex: evLog.index,
    });
    return true;
  }
  addMany(logs) {
    let added = 0;
    for (const l of logs) if (this.add(l)) added++;
    return added;
  }
  list() {
    return [...this.items.values()].sort((x, y) => y.blockNumber - x.blockNumber || y.logIndex - x.logIndex);
  }
  get size() {
    return this.items.size;
  }
}

/** История событий контракта в диапазоне блоков (только WATCHED_EVENTS). */
export async function fetchEvents(provider, address, fromBlock, toBlock = 'latest') {
  const c = new Contract(address, REGISTRY_ABI, provider);
  const logs = await c.queryFilter('*', fromBlock, toBlock);
  return logs.filter((l) => l.fragment && WATCHED_EVENTS.includes(l.fragment.name));
}
