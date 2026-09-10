async function pollSmsHealth() {
    const url = 'https://primore-admin-server.onrender.com/api/admin/sms-health';
    console.log(`[Poll] Waiting for Render to redeploy with new sms-health route...`);
    
    for (let i = 1; i <= 20; i++) {
        try {
            const res = await fetch(url);
            const json = await res.json().catch(() => ({}));
            console.log(`[Attempt ${i}] HTTP ${res.status}:`, JSON.stringify(json));
            if (res.status !== 401 && res.status !== 403) {
                console.log('=> Render has redeployed! sms-health is live.');
                break;
            }
        } catch (e) {
            console.log(`[Attempt ${i}] Error: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 15000)); // wait 15s between polls
    }
}
pollSmsHealth();
