const { spawn } = require('child_process');

function cleanNodeOptions(nodeOptions) {
  if (!nodeOptions || typeof nodeOptions !== 'string') return undefined;
  const cleaned = nodeOptions
    .split(/\s+/)
    .filter(Boolean)
    .filter((opt) => opt !== '--openssl-legacy-provider')
    .join(' ');
  return cleaned || undefined;
}

function main() {
  const electronPath = require('electron');
  const args = ['.', ...process.argv.slice(2)];

  const env = { ...process.env };
  const cleaned = cleanNodeOptions(env.NODE_OPTIONS);
  if (cleaned) env.NODE_OPTIONS = cleaned;
  else delete env.NODE_OPTIONS;

  const child = spawn(electronPath, args, {
    stdio: 'inherit',
    env,
    cwd: process.cwd()
  });

  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
