// Работа с кошельком через EIP-1193 (window.ethereum, MetaMask).
// Кошелёк хранит ключи и подписывает; dApp ключей не видит.
import { getAddress } from 'ethers';
import { ANVIL_CHAIN_PARAMS } from '../shared/config.js';

export const getEthereum = () => (typeof window !== 'undefined' ? window.ethereum : undefined);

export async function requestAccount(eth) {
  const accounts = await eth.request({ method: 'eth_requestAccounts' }); // окно подключения MetaMask
  if (!accounts?.length) throw new Error('Кошелёк не вернул ни одного аккаунта');
  return getAddress(accounts[0]);
}

export async function readChainId(eth) {
  return BigInt(await eth.request({ method: 'eth_chainId' }));
}

/** Завершение сеанса в приложении: забываем аккаунт и, если кошелёк поддерживает, отзываем разрешение. */
export async function revokeSession(eth) {
  try {
    await eth.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
    return true;
  } catch {
    return false; // старые версии кошелька: сеанс завершается только на стороне dApp
  }
}

/** Переключение на Anvil; если сеть неизвестна кошельку (4902) — добавить её. */
export async function switchToAnvil(eth) {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: ANVIL_CHAIN_PARAMS.chainId }] });
  } catch (e) {
    const code = e?.code ?? e?.data?.originalError?.code;
    if (code === 4902) {
      await eth.request({ method: 'wallet_addEthereumChain', params: [ANVIL_CHAIN_PARAMS] });
    } else {
      throw e;
    }
  }
}
