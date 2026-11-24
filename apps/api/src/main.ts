import 'reflect-metadata';
import { createApp } from './bootstrap';

async function main() {
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API listen port');
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(port, '0.0.0.0');
}

main().catch(() => {
  process.stderr.write('{"level":"fatal","event":"api_start_failed"}\n');
  process.exitCode = 1;
});
