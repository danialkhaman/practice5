// Запуск локального узла Anvil для тестов и нагрузочного эксперимента.
// Используются только встроенные тестовые аккаунты Anvil (разблокированы на узле),
// поэтому закрытые ключи в коде и в .env не нужны.
import { spawn } from 'node:child_process';

export async function startAnvil({ port = 8555, blockTime = 0, chainId = 31337, extraArgs = [] } = {}) {
  const args = ['--port', String(port), '--chain-id', String(chainId), '--accounts', '10', '--silent', ...extraArgs];
  if (blockTime > 0) args.push('--block-time', String(blockTime));
  const bin = process.env.ANVIL_BIN || 'anvil';
  const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => (stderr += d.toString()));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`anvil завершился: ${stderr}`);
    try {
      // простой fetch, а не ethers-провайдер: провайдер, созданный до старта узла,
      // уходит в бесконечные повторы определения сети и не даёт процессу завершиться
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      if ((await r.json()).result) break;
    } catch {
      if (Date.now() > deadline) throw new Error(`anvil не ответил на ${url}: ${stderr}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return {
    url,
    proc,
    async stop() {
      if (proc.exitCode === null) {
        proc.kill('SIGTERM');
        await new Promise((r) => proc.once('exit', r));
      }
    },
  };
}
