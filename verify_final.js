async function check() {
    const urls = [
        'https://primora-client.onrender.com/',
        'https://primore-admin.onrender.com/',
        'https://primore-admin-server.onrender.com/api/admin/reseller/status'
    ];
    console.log('--- LIVE AUDIT RESULT ---');
    for (const url of urls) {
        try {
            const res = await fetch(url);
            console.log(`[HTTP ${res.status}] ${url}`);
        } catch (e) {
            console.error(`Error: ${url}`, e.message);
        }
    }
}
check();
