import { Contract, Interface } from 'ethers';
import { REGISTRY_ABI } from './abi.js';
import { EXPECTED_CHAIN_ID, ROLES, machineIdToBytes32, bytes32ToMachineId } from './config.js';
import { decodeError, parseRevertData, ErrorKind, TxError } from './errors.js';

export const iface = new Interface(REGISTRY_ABI);

// Этапы транзакции, которые видит пользователь (Задание 1.3).
export const Stage = {
  CHECKING: 'checking', // проверка сети + симуляция вызова (eth_call)
  SIGNING: 'signing', // ожидание подписи в кошельке
  SENT: 'sent', // транзакция отправлена, есть хеш
  CONFIRMING: 'confirming', // ожидание включения в блок (квитанции)
  SUCCESS: 'success', // receipt.status = 1
  ERROR: 'error', // отказ подписи / неверная сеть / откат / ошибка RPC
};

export const STAGE_LABELS = {
  checking: 'Проверка сети и симуляция',
  signing: 'Ожидание подписи',
  sent: 'Отправлена',
  confirming: 'Ожидание подтверждения',
  success: 'Успех',
  error: 'Ошибка',
};

/** Разбор логов квитанции в события контракта. */
export function parseReceiptEvents(receipt, address) {
  const out = [];
  for (const log of receipt?.logs ?? []) {
    if (address && log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const p = iface.parseLog(log);
      if (p) out.push({ name: p.name, args: p.args, logIndex: log.index, blockNumber: log.blockNumber, txHash: log.transactionHash });
    } catch {
      /* чужое событие */
    }
  }
  return out;
}

/**
 * Причина отката уже включённой в блок транзакции. События откатившейся
 * транзакции в журнал не попадают, поэтому повторяем вызов (eth_call) на
 * состоянии предыдущего блока и раскодируем revert data.
 */
export async function decodeFailedReceipt(provider, tx, receipt) {
  try {
    await provider.call({ to: tx.to, from: tx.from, data: tx.data, value: tx.value ?? 0n, blockTag: receipt.blockNumber - 1 });
    return { name: 'UnknownRevert', args: {}, message: 'Вызов на предыдущем блоке не откатился (состояние изменилось внутри блока)' };
  } catch (e) {
    const d = decodeError(e);
    return { name: d.name, args: d.args, message: d.message };
  }
}

export class RegistryClient {
  /**
   * @param {object} o
   * @param {string} o.address адрес контракта
   * @param {import('ethers').Provider} o.provider провайдер для чтения
   * @param {import('ethers').Signer} [o.signer] подписант (кошелёк)
   * @param {bigint} [o.expectedChainId]
   * @param {(rec:object)=>void} [o.log] прикладной журнал (телеметрия)
   */
  constructor({ address, provider, signer = null, expectedChainId = EXPECTED_CHAIN_ID, log = () => {} }) {
    this.address = address;
    this.provider = provider;
    this.signer = signer;
    this.expectedChainId = BigInt(expectedChainId);
    this.log = log;
    this.read = new Contract(address, REGISTRY_ABI, provider);
  }

  withSigner(signer) {
    return new RegistryClient({ address: this.address, provider: this.provider, signer, expectedChainId: this.expectedChainId, log: this.log });
  }

  // ---------------- чтение (без подписи, без газа) ----------------
  async totalRecords() {
    return await this.read.totalRecords();
  }
  async paused() {
    return await this.read.paused();
  }
  async serviceCount(machineText) {
    return await this.read.serviceCount(machineIdToBytes32(machineText));
  }
  async getLastService(machineText) {
    const r = await this.read.getLastService(machineIdToBytes32(machineText));
    return {
      machineId: machineText,
      serviceCode: Number(r.serviceCode),
      timestamp: Number(r.timestamp),
      technician: r.technician,
      documentHash: r.documentHash,
      revoked: r.revoked,
      exists: r.technician !== '0x0000000000000000000000000000000000000000',
    };
  }
  async verifyDocument(machineText, documentHash) {
    return await this.read.verifyDocument(machineIdToBytes32(machineText), documentHash);
  }
  async rolesOf(account) {
    const [def, admin, tech] = await Promise.all([
      this.read.hasRole(ROLES.DEFAULT_ADMIN_ROLE, account),
      this.read.hasRole(ROLES.ADMIN_ROLE, account),
      this.read.hasRole(ROLES.TECHNICIAN_ROLE, account),
    ]);
    return { defaultAdmin: def, admin, technician: tech };
  }

  // ---------------- запись (подпись кошельком) ----------------
  registerService({ machineId, serviceCode, timestamp, documentHash }, opts) {
    return this.sendTx('registerService', [machineIdToBytes32(machineId), serviceCode, timestamp, documentHash], opts);
  }
  revokeLastService(machineId, opts) {
    return this.sendTx('revokeLastService', [machineIdToBytes32(machineId)], opts);
  }
  pause(opts) {
    return this.sendTx('pause', [], opts);
  }
  unpause(opts) {
    return this.sendTx('unpause', [], opts);
  }
  grantTechnician(account, opts) {
    return this.sendTx('grantRole', [ROLES.TECHNICIAN_ROLE, account], opts);
  }

  async assertNetwork() {
    const net = await (this.signer?.provider ?? this.provider).getNetwork();
    if (net.chainId !== this.expectedChainId) {
      throw new TxError({
        kind: ErrorKind.WRONG_NETWORK,
        name: 'WrongNetwork',
        args: { chainId: net.chainId.toString(), expected: this.expectedChainId.toString() },
        message: `Неверная сеть: chainId ${net.chainId}, нужен ${this.expectedChainId}`,
      });
    }
    return net.chainId;
  }

  /**
   * Отправка транзакции с явными этапами.
   * @param {string} method
   * @param {any[]} args
   * @param {object} [opts]
   * @param {(stage:string, info:object)=>void} [opts.onStage]
   * @param {boolean} [opts.skipPreflight] не делать eth_call перед отправкой (демонстрация отката в блоке)
   * @param {bigint|number} [opts.gasLimit] фиксированный лимит газа (вместе со skipPreflight)
   * @param {string} [opts.correlationId]
   * @param {number} [opts.nonce] явный nonce (нагрузочный тест)
   */
  async sendTx(method, args, opts = {}) {
    const { onStage = () => {}, skipPreflight = false, gasLimit, correlationId, nonce } = opts;
    const t0 = Date.now();
    const stage = (s, info = {}) => {
      onStage(s, info);
      this.log({ category: 'app', event: `tx.${s}`, correlationId, method, ...info });
    };
    if (!this.signer) throw new TxError({ kind: ErrorKind.UNKNOWN, name: 'NoSigner', args: {}, message: 'Кошелёк не подключён' });
    const from = await this.signer.getAddress();
    const c = new Contract(this.address, REGISTRY_ABI, this.signer);
    let tx = null;
    try {
      stage(Stage.CHECKING, { from });
      const chainId = await this.assertNetwork();
      if (!skipPreflight) await c[method].staticCall(...args); // симуляция: откат виден ДО подписи

      stage(Stage.SIGNING, { from, chainId: chainId.toString() });
      const overrides = {};
      if (gasLimit) overrides.gasLimit = BigInt(gasLimit);
      if (nonce !== undefined) overrides.nonce = nonce;
      tx = await c[method](...args, overrides);

      stage(Stage.SENT, { from, txHash: tx.hash, nonce: tx.nonce });
      stage(Stage.CONFIRMING, { txHash: tx.hash });
      let receipt;
      try {
        receipt = await tx.wait();
      } catch (e) {
        if (e?.receipt) receipt = e.receipt; // status = 0: ethers бросает CALL_EXCEPTION с квитанцией
        else throw e;
      }

      if (receipt.status === 0) {
        const reason = await decodeFailedReceipt(this.provider, tx, receipt);
        const info = {
          from,
          kind: ErrorKind.REVERT,
          phase: 'onchain',
          name: reason.name,
          args: reason.args,
          message: `Откат в блоке ${receipt.blockNumber}: ${reason.message}`,
          txHash: tx.hash,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed.toString(),
          status: 0,
        };
        stage(Stage.ERROR, { ...info, ms: Date.now() - t0 });
        throw new TxError({ ...info, receipt });
      }

      const events = parseReceiptEvents(receipt, this.address);
      stage(Stage.SUCCESS, {
        txHash: tx.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed.toString(),
        status: 1,
        events: events.map((e) => e.name),
        ms: Date.now() - t0,
      });
      return { hash: tx.hash, receipt, events };
    } catch (e) {
      if (e instanceof TxError && e.phase === 'onchain') throw e;
      const d = decodeError(e);
      const info = {
        from,
        kind: d.kind,
        phase: tx ? 'after-send' : d.kind === ErrorKind.REVERT ? 'preflight' : 'before-send',
        name: d.name,
        args: d.args,
        message: d.message,
        txHash: tx?.hash,
      };
      stage(Stage.ERROR, { ...info, ms: Date.now() - t0 });
      throw new TxError(info);
    }
  }
}

export { machineIdToBytes32, bytes32ToMachineId, parseRevertData };
