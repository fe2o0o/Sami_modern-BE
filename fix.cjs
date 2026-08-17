const mysql = require('mysql2/promise');
(async () => {
  const c = await mysql.createConnection({host:'localhost',port:3306,user:'root',password:''});
  const [rows] = await c.query('SHOW PROCESSLIST');
  for (const r of rows) {
    if (r.User === 'root' && (r.Command === 'Query') && r.Info && r.Id !== undefined && /CREATE TABLE|metadata lock|information_schema|INFORMATION_SCHEMA/i.test(r.Info) ) {
      try { await c.query(`KILL ${r.Id}`); console.log('killed', r.Id, (r.Info||'').slice(0,40)); } catch(e){ console.log('kill fail', r.Id, e.message); }
    }
  }
  await c.query('DROP DATABASE IF EXISTS sami_modern');
  await c.query('CREATE DATABASE sami_modern CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  console.log('recreated sami_modern');
  await c.end();
})().catch(e=>{console.error('FIX ERR', e.message); process.exit(1);});
