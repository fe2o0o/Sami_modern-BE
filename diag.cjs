const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({host:'localhost',port:3306,user:'root',password:'',database:'sami_modern'});
  const [rows] = await c.query('SHOW FULL PROCESSLIST');
  for (const r of rows) console.log(`id=${r.Id} user=${r.User} cmd=${r.Command} time=${r.Time} state=${r.State||''} info=${(r.Info||'').slice(0,60)}`);
  console.log('--- tables ---');
  const [t] = await c.query("SHOW TABLES");
  console.log(t.map(x=>Object.values(x)[0]).join(', ') || '(none)');
  await c.end();
})().catch(e=>{console.error('DIAG ERR', e.message); process.exit(1);});
