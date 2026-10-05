// Build fresh signatures immediately before each check (application TTL: 120s).
const kinds = ['projects','saved-searches','alerts','peer-sets','memo','annotations','research-tabs','watchlist','checklists'];
const requests = [];
for (const kind of kinds) for (const who of ['a','b','org']) for (const operation of ['list','upsert','delete']) {
  requests.push({name:`${who}.${kind}.${operation}`,operation,kind,
    userId:who === 'b' ? 'user_dryrun_b' : 'user_dryrun_a',orgId:who === 'org' ? 'org_dryrun' : null});
}
for (const [name,offset] of [['expired',-1200000],['future',1200000]]) {
  requests.push({name,operation:'list',kind:'watchlist',userId:'user_dryrun_a',orgId:null,nowMs:Date.now()+offset});
}
// Keep the P1 requests unchanged when migration 029 is absent. tsx passes the
// alert-hits string through the real signer despite the older UserDataKind type.
if (process.argv[2] === 'p9') {
  for (const who of ['a','b','org']) for (const operation of ['list','upsert']) {
    requests.push({name:`${who}.alert-hits.${operation}`,operation,kind:'alert-hits',
      userId:who === 'b' ? 'user_dryrun_b' : 'user_dryrun_a',orgId:who === 'org' ? 'org_dryrun' : null});
  }
  for (const operation of ['list','upsert']) {
    requests.push({name:`expired.alert-hits.${operation}`,operation,kind:'alert-hits',
      userId:'user_dryrun_a',orgId:null,nowMs:Date.now()-1200000});
  }
}
process.stdout.write(JSON.stringify(requests));
