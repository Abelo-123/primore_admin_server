const health = await fetch('https://primore-admin-server.onrender.com/api/admin/sms-health');
const direct = await fetch('https://primore-admin-server.onrender.com/api/admin/reseller/send-direct-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reseller_name: 'Test', amount: 1 })
});
console.log('sms-health:', health.status, JSON.stringify(await health.json()));
console.log('send-direct-sms:', direct.status, JSON.stringify(await direct.json()));
