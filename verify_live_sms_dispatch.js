async function verifySmsDispatch() {
    console.log('--- CALLING LIVE /api/admin/reseller/withdraw-sms-notify WITH PEQBNQ8X1P6MBJH76701ZUGIX5DP7UOZ:1098 ---');
    try {
        const res = await fetch('https://primore-admin-server.onrender.com/api/admin/reseller/withdraw-sms-notify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                local_id: 'VERIFY-LIVE',
                amount: 50,
                bank_name: 'Commercial Bank of Ethiopia',
                account_number: '1000123456789',
                account_name: 'Test Holder'
            })
        });

        console.log(`HTTP Status: ${res.status}`);
        const data = await res.json();
        console.log('Live Server Response:', JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Error fetching live endpoint:', err.message);
    }
}

verifySmsDispatch();
