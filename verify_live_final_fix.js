async function verifyLive() {
    const urls = [
        'https://primore-admin-server.onrender.com/api/admin/reseller/status',
        'https://primore-admin.onrender.com/'
    ];

    console.log('--- FINAL LIVE DEPLOYMENT VERIFICATION ---');
    for (const url of urls) {
        try {
            const res = await fetch(url);
            console.log(`[HTTP ${res.status}] ${url}`);
            if (res.ok || res.status === 200 || res.status === 401) {
                console.log(`=> Endpoint online and active.`);
            } else {
                console.warn(`=> Status ${res.status}`);
            }
        } catch (err) {
            console.error(`=> Error fetching ${url}:`, err.message);
        }
    }

    console.log('--- TESTING LIVE /api/admin/reseller/withdraw-sms-notify DISPATCH ---');
    try {
        const smsRes = await fetch('https://primore-admin-server.onrender.com/api/admin/reseller/withdraw-sms-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                local_id: 'LIVE-AUDIT',
                amount: 1,
                bank_name: 'CBE',
                account_number: '1000000000000',
                account_name: 'Live Audit Test'
            })
        });
        console.log(`SMS Endpoint HTTP Status: ${smsRes.status}`);
        const smsData = await smsRes.json();
        console.log('SMS Endpoint Response:', JSON.stringify(smsData, null, 2));
    } catch (err) {
        console.error('Error testing live SMS endpoint:', err.message);
    }
}

verifyLive();
