#!/usr/bin/env python3
"""FS Decision JSONL adapter for the pinned Laya snapshot. Experimental shadow use only."""
import json,os,sys
HERE=os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0,HERE)
from laya import Agent

def laya_questions(questions):
 out=[]
 for q in questions:
  if q['type']=='choice': out.append({'id':q['id'],'type':'choice','instructions':q.get('instructions') or f"Choose the best option for {q['id']}.",'criteria':q['options']})
  elif q['type']=='score': out.append({'id':q['id'],'type':'score','instructions':q.get('instructions') or f"Score {q['id']} on the ordered levels.",'criteria':q['levels']})
  else: out.append({'id':q['id'],'type':'noul','instructions':q.get('instructions') or q['proposition'],'criteria':['false','true']})
 return out

def convert_answer(q,a):
 probs=a.get('probabilities') or []; criteria=q.get('options') or q.get('levels') or ['false','true']; dist={str(k):float(probs[i]) if i<len(probs) else 0.0 for i,k in enumerate(criteria)}; confidence=float(a.get('confidence',0.0)); base={'id':q['id'],'type':q['type'],'distribution':dist,'confidence':confidence,'abstained':False,'reason':'Pinned Laya shadow inference; not authoritative.'}
 if q['type']=='noul': base['probabilityTrue']=float(a.get('p_true',dist.get('true',0.0)))
 elif q['type']=='score': base['selected']=str(a.get('choice',criteria[max(range(len(probs)),key=lambda i:probs[i]) if probs else 0])); base['expectedScore']=float(a.get('expected_score',0.0))
 else: base['selected']=str(a.get('choice',criteria[max(range(len(probs)),key=lambda i:probs[i]) if probs else 0]))
 return base

def main():
 model=os.environ.get('FS_LAYA_MODEL_PATH');
 if not model: raise RuntimeError('FS_LAYA_MODEL_PATH must point to a preverified local model directory; network model resolution is forbidden.')
 agent=Agent(model_path=model,device=os.environ.get('FS_LAYA_DEVICE','cpu'))
 line=sys.stdin.readline(); req=json.loads(line); qs=laya_questions(req['questions']); raw=agent.system_one(req['state'],qs); answers=[convert_answer(q,a) for q,a in zip(req['questions'],raw['questions'])]; print(json.dumps({'schemaVersion':'fs.decision.result.v1','provider':'laya-shadow','answers':answers,'evidence':{'stateSchemaVersion':req['state']['schemaVersion'],'providerVersion':'pinned-v0.3.6','policyVersion':'shadow-only','authoritative':False,'notes':['act_probability intentionally ignored; upstream typed fine-tune does not train act_head.']},'createdAt':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()}),flush=True)
if __name__=='__main__': main()
