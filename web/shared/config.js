import { id, ZeroHash, encodeBytes32String, decodeBytes32String } from 'ethers';

// Ожидаемая сеть: локальный Anvil (chainId 31337 = 0x7a69).
export const EXPECTED_CHAIN_ID = 31337n;

export const ANVIL_CHAIN_PARAMS = {
  chainId: '0x7a69',
  chainName: 'Anvil localhost (ПР5)',
  rpcUrls: ['http://127.0.0.1:8545'],
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
};

// Роли контракта (совпадают с keccak256 в Solidity).
export const ROLES = {
  DEFAULT_ADMIN_ROLE: ZeroHash,
  ADMIN_ROLE: id('ADMIN_ROLE'),
  TECHNICIAN_ROLE: id('TECHNICIAN_ROLE'),
};

export function roleName(role) {
  const r = String(role).toLowerCase();
  for (const [name, value] of Object.entries(ROLES)) if (value.toLowerCase() === r) return name;
  return `${String(role).slice(0, 10)}…`;
}

// Справочник кодов этапов ТО (варианта 8 «Промышленность»).
export const SERVICE_CODES = [
  { code: 101, label: 'Плановое ТО' },
  { code: 201, label: 'Внеплановый ремонт' },
  { code: 301, label: 'Калибровка' },
  { code: 401, label: 'Диагностика' },
];

export function serviceLabel(code) {
  const c = SERVICE_CODES.find((s) => s.code === Number(code));
  return c ? c.label : `код ${code}`;
}

// Идентификатор станка: короткая ASCII-строка (до 31 байта) -> bytes32.
export function machineIdToBytes32(text) {
  const t = String(text ?? '').trim();
  if (!t) throw new Error('Пустой идентификатор станка');
  if (!/^[A-Za-z0-9._-]{1,31}$/.test(t)) {
    throw new Error('Идентификатор станка: латиница, цифры, «.», «_», «-», до 31 символа');
  }
  return encodeBytes32String(t);
}

export function bytes32ToMachineId(b) {
  try {
    return decodeBytes32String(b);
  } catch {
    return b;
  }
}

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '—');
