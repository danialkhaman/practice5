import { Interface, isHexString } from 'ethers';
import { REGISTRY_ABI } from './abi.js';
import { roleName, shortAddr } from './config.js';

const iface = new Interface(REGISTRY_ABI);

// Виды ошибок, которые различает клиент.
export const ErrorKind = {
  USER_REJECTED: 'USER_REJECTED', // пользователь отклонил подпись в кошельке (EIP-1193 code 4001)
  WRONG_NETWORK: 'WRONG_NETWORK', // кошелёк подключён не к той сети
  REVERT: 'REVERT', // контракт откатил вызов (custom error / require)
  RPC: 'RPC', // ошибка узла/транспорта: таймаут, недоступен, 5xx
  UNKNOWN: 'UNKNOWN',
};

export class TxError extends Error {
  constructor(info) {
    super(info.message);
    this.name = 'TxError';
    Object.assign(this, info);
  }
}

// Ищем в дереве ошибки (MetaMask/ethers вкладывают её на 2–3 уровня) hex-данные отката.
function findRevertData(err, depth = 0) {
  if (!err || depth > 6) return null;
  if (typeof err === 'string') return isHexString(err) && err.length >= 10 ? err : null;
  if (typeof err !== 'object') return null;
  for (const k of ['data', 'error', 'info', 'cause', 'originalError', 'payload']) {
    if (!(k in err)) continue;
    const v = err[k];
    if (typeof v === 'string' && isHexString(v) && v.length >= 10) return v;
    const nested = findRevertData(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function hasCode(err, code, depth = 0) {
  if (!err || typeof err !== 'object' || depth > 6) return false;
  if (err.code === code) return true;
  return ['error', 'info', 'cause', 'originalError'].some((k) => hasCode(err[k], code, depth + 1));
}

const HUMAN = {
  AccessControlUnauthorizedAccount: (a) =>
    `Нет полномочий: у ${shortAddr(a.account)} нет роли ${roleName(a.neededRole)} (проверка в контракте)`,
  EnforcedPause: () => 'Контракт на паузе: изменение состояния запрещено',
  ExpectedPause: () => 'Контракт не на паузе',
  InvalidServiceCode: () => 'Код этапа ТО должен быть больше 0',
  EmptyMachineId: () => 'Пустой идентификатор станка',
  TimestampInFuture: (a) => `Время этапа в будущем: ${a.provided} > ${a.blockTime}`,
  NothingToRevoke: () => 'Нечего отзывать: записи нет или она уже отозвана',
  AccessControlBadConfirmation: () => 'Неверное подтверждение отказа от роли',
};

export function parseRevertData(data) {
  try {
    const desc = iface.parseError(data);
    if (!desc) return null;
    const args = {};
    desc.fragment.inputs.forEach((inp, i) => {
      const v = desc.args[i];
      args[inp.name] = typeof v === 'bigint' ? v.toString() : v;
    });
    return { name: desc.name, args, selector: desc.selector };
  } catch {
    return null;
  }
}

/**
 * Приводит любую ошибку ethers/MetaMask/RPC к единому виду.
 * @returns {{kind:string, name:string|null, args:object, message:string, code:any}}
 */
export function decodeError(err) {
  if (err instanceof TxError) return err;
  if (err?.kind && ErrorKind[err.kind]) return err;

  // 1. Отказ пользователя в подписи: ethers v6 -> ACTION_REJECTED, EIP-1193 -> 4001.
  if (hasCode(err, 'ACTION_REJECTED') || hasCode(err, 4001)) {
    return { kind: ErrorKind.USER_REJECTED, name: 'UserRejected', args: {}, code: 4001, message: 'Подпись отклонена пользователем в кошельке' };
  }

  // 2. Откат контракта: ethers уже раскодировал (err.revert) или ищем данные вручную.
  if (err?.revert?.name) {
    const args = {};
    const frag = iface.getError(err.revert.name);
    frag?.inputs.forEach((inp, i) => {
      const v = err.revert.args[i];
      args[inp.name] = typeof v === 'bigint' ? v.toString() : v;
    });
    const h = HUMAN[err.revert.name];
    return { kind: ErrorKind.REVERT, name: err.revert.name, args, code: 'CALL_EXCEPTION', message: h ? h(args) : err.revert.name };
  }
  const data = findRevertData(err);
  if (data) {
    const p = parseRevertData(data);
    if (p) {
      const h = HUMAN[p.name];
      return { kind: ErrorKind.REVERT, name: p.name, args: p.args, code: 'CALL_EXCEPTION', message: h ? h(p.args) : p.name };
    }
  }
  if (err?.code === 'CALL_EXCEPTION') {
    return { kind: ErrorKind.REVERT, name: 'UnknownRevert', args: {}, code: 'CALL_EXCEPTION', message: err.shortMessage || 'Транзакция откатилась (причина не раскодирована)' };
  }

  // 3. Сеть / транспорт.
  const netCodes = ['NETWORK_ERROR', 'TIMEOUT', 'SERVER_ERROR', 'BAD_DATA'];
  if (netCodes.includes(err?.code) || /ECONNREFUSED|fetch failed|Failed to fetch|timeout|socket hang up/i.test(err?.message || '')) {
    return { kind: ErrorKind.RPC, name: err?.code || 'RpcError', args: {}, code: err?.code, message: `Ошибка RPC: ${err?.shortMessage || err?.message}` };
  }

  return { kind: ErrorKind.UNKNOWN, name: err?.code || 'Error', args: {}, code: err?.code, message: err?.shortMessage || err?.message || String(err) };
}
