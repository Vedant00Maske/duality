// Runs the game server and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['run', 'dev', '-w', 'apps/server'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['run', 'dev', '-w', 'apps/web'], { stdio: 'inherit', shell: true }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
