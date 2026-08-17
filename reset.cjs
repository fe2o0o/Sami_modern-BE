const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({host:'localhost',port:3306,user:'root',password:'',multipleStatements:true});
  const [[me]] = await c.query('SELECT CONNECTION_ID() AS id');
  const myId = me.id;
  const [rows] = await c.query('SHOW PROCESSLIST');
  for (const r of rows) {
    if (r.Id !== myId && r.User !== 'system user' && r.User !== 'event_scheduler') {
      try { await c.query(`KILL ${r.Id}`); console.log('killed', r.Id, r.User, r.Command); } catch(e){ console.log('kill fail', r.Id, e.message); }
    }
  }
  await c.query('SET SESSION lock_wait_timeout = 8');
  await c.query('DROP DATABASE IF EXISTS sami_modern');
  await c.query('CREATE DATABASE sami_modern CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  console.log('OK: sami_modern recreated clean');
  await c.end();
})().catch(e=>{console.error('RESET ERR', e.code||'', e.message); process.exit(1);});
