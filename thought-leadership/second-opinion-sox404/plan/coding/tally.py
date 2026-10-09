import json,glob,collections,csv,sys
C='./'
R=[]
for f in sorted(glob.glob(C+'final_batch*.jsonl')):
    R+=[json.loads(l) for l in open(f) if l.strip()]
def key(x): return (x or '').replace('.txt','').rsplit('.',1)[0] if x and x.endswith(('.pdf','.html','.htm','.txt')) else (x or '')
for r in R: r['file']=key(r['file'])
T=lambda v: v in (True,'true','True')
idx=list(csv.DictReader(open('../S7-2026-18_docket_index_2026-10-09.csv')))
pub=[x for x in idx if x['type']=='Public Comment']; memos=[x for x in idx if x['type']!='Public Comment']
files={key(x['file']) for x in pub}
coded={r['file'] for r in R}
print('records',len(R),'| public comments on listing',len(pub),'| uncoded',sorted(files-coded)[:10],'| extra',sorted(coded-files)[:5])
late=[r for r in R if T(r.get('late'))]
oct5=[r for r in R if not T(r.get('late'))]
print('Entries as of Oct 5 (listing minus late, plus memos):',len(pub)-len(late)+len(memos))
nac=[r for r in oct5 if T(r.get('not_a_comment'))]
dup=[r for r in oct5 if r.get('same_filer_as') and not T(r.get('not_a_comment'))]
D=[r for r in oct5 if not T(r.get('not_a_comment')) and not r.get('same_filer_as')]
print('not_a_comment',len(nac),[r['commenter'][:30] for r in nac]); print('duplicates',len(dup))
print('DISTINCT COMMENTERS',len(D),'(paper 172)')
A=[r for r in D if T(r.get('addresses_attestation'))]
print('ADDRESSED',len(A),'(paper 118) | silent',len(D)-len(A),'(paper 54)')
pos=collections.Counter(r.get('position') for r in A); print('POSITION',dict(pos),'(paper support 32, no_position 11, too_broad 32, do_not_expand 43)')
print('75 of 118 ->',pos['too_broad']+pos['do_not_expand'],'of',len(A))
tb=[r for r in A if r.get('position')=='too_broad']
print('guarded among too_broad',sum(T(r.get('guarded')) for r in tb),'(paper 9) | named alternative among too_broad',sum(T(r.get('names_alternative')) for r in tb),'(paper 20)')
print('guidance_for_companies',sum(T(r.get('guidance_for_companies')) for r in A),'(paper 12)')
inv=[r for r in A if r.get('constituency')=='investor']
print('investors addressing',len(inv),'too_broad+dne',sum(r.get('position') in('too_broad','do_not_expand') for r in inv),'(paper 25 of 27)')
print('BY CONSTITUENCY:')
cc=collections.defaultdict(collections.Counter)
for r in A: cc[r.get('constituency')][r.get('position')]+=1
for c,v in sorted(cc.items(), key=lambda kv:-sum(kv[1].values())): print('  %-28s %s'%(c,dict(v)))
on=[r for r in D if T(r.get('addresses_onramp'))]
print('ONRAMP addressed',len(on),'rejects/questions',sum(r.get('onramp_view')=='rejects_or_questions' for r in on),'(paper 55 of 74)')
print('REVENUE TEST',sum(T(r.get('revenue_test')) for r in D),'(paper 13)')
b=[r for r in D if T(r.get('addresses_2bn_figure'))]
print('2BN addressed',len(b),dict(collections.Counter(r.get('view_2bn') for r in b)),'(paper 51: 24 supports / 15 lower / 3 higher / 9 oppose)')
print('DISCLOSURE',sum(T(r.get('asks_disclosure')) for r in D),'(paper 4)',[r['commenter'][:25] for r in D if T(r.get('asks_disclosure'))])
ir=[r for r in D if T(r.get('asks_interim_relief'))]; print('INTERIM RELIEF',len(ir),[(r['commenter'][:25],r.get('constituency')) for r in ir],'(paper: 1 association + 2 issuers)')
fp=[r for r in D if T(r.get('fpi_parity'))]; print('FPI PARITY',len(fp),[(r['commenter'][:25],r.get('constituency')) for r in fp])
side=[r for r in A if r.get('position')!='no_position']
for c in ('company','exchange','business_trade_association'):
    print('  %s taking a side:'%c, dict(collections.Counter(r.get('position') for r in side if r.get('constituency')==c)))
json.dump(D,open('./distinct.json','w'),default=str)
