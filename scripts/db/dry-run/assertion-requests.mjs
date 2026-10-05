// Build fresh signatures immediately before P1 (the application's TTL is 120s).
const kinds = ['projects','saved-searches','alerts','peer-sets','memo','annotations','research-tabs','watchlist','checklists'];
const requests = [];
for (const kind of kinds) for (const who of ['a','b','org']) for (const operation of ['list','upsert','delete']) {
  requests.push({name:`${who}.${kind}.${operation}`,operation,kind,
    userId:who === 'b' ? 'user_dryrun_b' : 'user_dryrun_a',orgId:who === 'org' ? 'org_dryrun' : null});
}
for (const [name,offset] of [['expired',-1200000],['future',1200000]]) {
  requests.push({name,operation:'list',kind:'watchlist',userId:'user_dryrun_a',orgId:null,nowMs:Date.now()+offset});
}
process.stdout.write(JSON.stringify(requests));
