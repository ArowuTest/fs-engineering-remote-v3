#!/usr/bin/env python3
"""FS Decision JSONL adapter for the pinned Laya snapshot. Experimental shadow use only."""
import datetime,json,os,sys
HERE=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,HERE)
from laya import Agent

def laya_questions(questions):
 out={}
 for q in questions:
  if q['type']=='choice': out[q['id']]={'type':'choice','instructions':q.get('instructions') or f"Choose the best option for {q['id']}.",'criteria':q['options']}
  elif q['type']=='score': out[q['id']]={'type':'score','instructions':q.get('instructions') or f"Score {q['id']} on the ordered levels.",'criteria':q['levels']}
  else: out[q['id']]={'type':'noul','instructions':q.get('instructions') or q['proposition']}
 return out

def convert_answer(q,a):
 criteria=q.get('options') or q.get('levels') or ['false','true']; raw=a.get('probabilities') or {}; dist={str(k):float(raw.get(str(k),raw.get(k,0.0))) for k in criteria}; confidence=float(a.get('confidence',0.0)); base={'id':q['id'],'type':q['type'],'distribution':dist,'confidence':confidence,'abstained':False,'reason':'Pinned Laya shadow inference; not authoritative.'}
 if q['type']=='noul': p=float(a.get('noul',0.5));base['probabilityTrue']=p;base['distribution']={'false':1-p,'true':p}
 elif q['type']=='score': base['expectedScore']=float(a.get('score',0.0));idx=max(range(len(criteria)),key=lambda i:float(raw.get(str(i),0.0))) if criteria else 0;base['selected']=str(criteria[idx]);base['distribution']={str(k):float(raw.get(str(i),0.0)) for i,k in enumerate(criteria)}
 else: base['selected']=str(a.get('choice',criteria[0] if criteria else ''))
 return base

def main():
 model=os.environ.get('FS_LAYA_MODEL_PATH')
 if not model: raise RuntimeError('FS_LAYA_MODEL_PATH must point to a preverified local model directory; network model resolution is forbidden.')
 agent=Agent(model_id_or_path=model,device=os.environ.get('FS_LAYA_DEVICE','cpu'))
 req=json.loads(sys.stdin.readline());raw=agent.system_one(req['state'],laya_questions(req['questions']));answers=[convert_answer(q,raw['answers'][q['id']]) for q in req['questions']]
 print(json.dumps({'schemaVersion':'fs.decision.result.v1','provider':'laya-shadow','answers':answers,'evidence':{'stateSchemaVersion':req['state']['schemaVersion'],'providerVersion':'pinned-v0.3.6','policyVersion':'shadow-only','authoritative':False,'notes':['act_probability intentionally ignored; upstream typed fine-tune does not train act_head.']},'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}),flush=True)
if __name__=='__main__': main()
