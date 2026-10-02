import test from 'node:test';
import assert from 'node:assert/strict';
import {dedupeFindings,blockersNeedSkeptic,type Finding} from '../src/finding-verification.js';
import {selectBlindReplacement} from '../src/council-replacement.js';

const item=(id:string):Finding=>({id,role:'correctness',severity:'high',location:'fixture.ts:1',claim:'Same observed defect',evidence:'same observation',status:'open',reviewerModel:'fixture',chunkId:'chunk-1'});

test('content-equal findings with different identities remain independently adjudicable',()=>{
 const a=item('id-a'),b=item('id-b');
 assert.deepEqual(dedupeFindings([a,b]).map(x=>x.id),['id-a','id-b']);
 assert.deepEqual(blockersNeedSkeptic([a,b]).map(x=>x.id),['id-a','id-b']);
});
test('same identity and same content may escalate severity without mutating the caller',()=>{
 const a={...item('id-a'),severity:'medium' as const},b={...item('id-a'),severity:'critical' as const};
 const result=dedupeFindings([a,b]);assert.equal(result.length,1);assert.equal(result[0].id,'id-a');assert.equal(result[0].severity,'critical');assert.equal(a.severity,'medium');
});
test('actual automatic fleet always supplies replacement assignment identity for free and consented paid capacity',()=>{
 const now=new Date().toISOString();const model=(id:string,free:boolean):any=>({id,provider:'openrouter',free,healthy:true,coding:.8,reasoning:.8,security:.8,context:1000,observedAt:now,source:'fixture',benchmarks:['coding','reasoning','security','toolUse','longContext'].map(d=>({benchmark:d,dimension:d,score:.8,observedAt:now,source:'fixture'}))});
 for(const role of ['correctness','security','architecture','testing'])for(const free of [true,false]){
  const selected=selectBlindReplacement([model('fixture',free)],role,[],()=>true);
  assert.ok(selected);assert.ok(selected.assignment);assert.equal(selected.assignment.modelId,selected.model.id);assert.equal(selected.assignment.provider,selected.model.provider);assert.equal(selected.assignment.role,role);
 }
 assert.equal(selectBlindReplacement([model('paid-only',false)],'correctness'),null);
});
