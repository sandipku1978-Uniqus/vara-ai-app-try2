import json,sys,collections
C='/tmp/claude-0/-home-user-vara-ai-app-try2/03d912ed-3371-5f98-a305-262c5837e4f0/scratchpad/letters/coding/'
F=['late','same_filer_as','not_a_comment','constituency','addresses_attestation','position','guarded','names_alternative','addresses_2bn_figure','view_2bn','addresses_onramp','onramp_view','revenue_test','asks_disclosure','asks_interim_relief','fpi_parity','guidance_for_companies']
def load(fn):
    d={}
    for l in open(C+fn):
        l=l.strip()
        if not l: continue
        r=json.loads(l); d[r['file'].replace('.txt','')]=r
    return d
def norm(v):
    if isinstance(v,str): v=v.strip().lower()
    if v in ('',None,False,'none','null'): return None
    if isinstance(v,str) and v.endswith(('.pdf','.html','.htm')): v=v.rsplit('.',1)[0]
    return v
batch=sys.argv[1]
a=load(f'coder1_{batch}.jsonl'); b=load(f'coder2_{batch}.jsonl')
keys=sorted(set(a)|set(b)); dis=collections.Counter(); out=[]
for k in keys:
    if k not in a or k not in b: out.append((k,'MISSING in '+('coder1' if k not in a else 'coder2'))); continue
    diffs={f:(a[k].get(f),b[k].get(f)) for f in F if norm(a[k].get(f))!=norm(b[k].get(f))}
    # guarded only matters for too_broad
    if 'guarded' in diffs and norm(a[k].get('position'))!='too_broad' and norm(b[k].get('position'))!='too_broad': diffs.pop('guarded')
    for f in diffs: dis[f]+=1
    if diffs: out.append((k,diffs))
print(batch,'letters',len(keys),'with any disagreement',len(out)); print(dict(dis))
json.dump([{'file':k,'diffs':v} for k,v in out],open(f'/tmp/claude-0/-home-user-vara-ai-app-try2/03d912ed-3371-5f98-a305-262c5837e4f0/scratchpad/recon/dis_{batch}.json','w'),indent=1,default=str)
