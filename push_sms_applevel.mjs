import { execSync } from 'child_process';

const cmds = [
    'git config user.email abeloabate01@gmail.com',
    'git config user.name Abelo-123',
    'git add index.js routes/admin.js',
    'git commit -m "fix(sms): move sms-health and send-direct-sms to app-level routes in index.js to bypass router ordering"',
    'git push originb master',
    'git push originb master:main',
];

for (const cmd of cmds) {
    try {
        const out = execSync(cmd, { encoding: 'utf8' });
        if (out.trim()) console.log(out.trim());
    } catch (e) {
        console.error(`FAILED: ${cmd}\n${e.stderr || e.message}`);
    }
}
console.log('Done.');
