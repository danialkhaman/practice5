// Развёртывание MaintenanceRegistry на локальный Anvil и назначение ролей.
// Запуск: npm run deploy:local   (сначала: cd ../contracts && forge build)
// Пишет public/deployment.json — его читает dApp и монитор.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, getAddress } from 'ethers';
import { ROLES } from '../shared/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = {
  secure: resolve(here, '../../contracts/out/MaintenanceRegistry.sol/MaintenanceRegistry.json'),
  // уязвимая версия из ПР №3 — только для негативного контроля проверки инвариантов в тестах
  vulnerable: resolve(here, '../../contracts/out/MaintenanceRegistryVulnerable.sol/MaintenanceRegistryVulnerable.json'),
};

/**
 * Роли тестовых аккаунтов Anvil:
 *  #0 администратор (DEFAULT_ADMIN_ROLE + ADMIN_ROLE + TECHNICIAN_ROLE, конструктор)
 *  #1 инженер ТО (TECHNICIAN_ROLE)
 *  #2 посторонний / аудитор (без ролей) — для негативных сценариев
 *  #3..#7 клиенты нагрузочного теста (TECHNICIAN_ROLE)
 */
export async function deployRegistry({ rpcUrl, variant = 'secure', grantLoadClients = true, log = console.log } = {}) {
  const provider = new JsonRpcProvider(rpcUrl, undefined, { staticNetwork: true, pollingInterval: 100, cacheTimeout: -1 });
  const accounts = (await provider.send('eth_accounts', [])).map((a) => getAddress(a)); // EIP-55 checksum
  if (accounts.length < 8) throw new Error('Нужно не меньше 8 аккаунтов Anvil');
  const [admin, technician, stranger, ...rest] = accounts;
  const loadClients = rest.slice(0, 5);

  if (!existsSync(ARTIFACTS[variant])) {
    throw new Error(`Нет артефакта ${ARTIFACTS[variant]}: выполните cd contracts && forge build (Slither пересобирает out/ без test/)`);
  }
  const art = JSON.parse(readFileSync(ARTIFACTS[variant], 'utf8'));
  const signer = await provider.getSigner(admin);
  const factory = new ContractFactory(art.abi, art.bytecode.object, signer);
  const contract = await factory.deploy(admin);
  const deployTx = contract.deploymentTransaction();
  const deployReceipt = await deployTx.wait();
  const address = await contract.getAddress();
  log(`MaintenanceRegistry (${variant}) развёрнут: ${address}, блок ${deployReceipt.blockNumber}, tx ${deployTx.hash}`);

  const grantees = grantLoadClients ? [technician, ...loadClients] : [technician];
  for (const acc of grantees) {
    const tx = await contract.grantRole(ROLES.TECHNICIAN_ROLE, acc);
    const r = await tx.wait();
    log(`  TECHNICIAN_ROLE -> ${acc} (блок ${r.blockNumber}, tx ${tx.hash})`);
  }
  const net = await provider.getNetwork();
  const info = {
    chainId: Number(net.chainId),
    address,
    deployBlock: deployReceipt.blockNumber,
    deployTx: deployTx.hash,
    variant,
    accounts: { admin, technician, stranger, loadClients },
  };
  provider.destroy();
  return info;
}

// CLI
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:8545';
  const info = await deployRegistry({ rpcUrl });
  const out = resolve(here, '../public/deployment.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(info, null, 2));
  console.log(`\nЗаписано: ${out}`);
  console.log(JSON.stringify(info, null, 2));
}
