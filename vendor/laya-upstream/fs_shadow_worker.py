#!/usr/bin/env python3
"""Persistent FS Decision JSONL worker for the pinned Laya snapshot. Shadow-only."""
import datetime,json,os,sys,time
HERE=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,HERE)
from laya import Agent
from fs_shadow_adapter import laya_questions,convert_answer
model=os.environ.get('FS_LAYA_MODEL_PATH')
if not model: raise RuntimeError('FS_LAYA_MODEL_PATH must point to a preverified local model directory; network model resolution is forbidden.')
started=time.perf_counter();agent=Agent(model_id_or_path=model,device=os.environ.get('FS_LAYA_DEVICE','cpu'));load_ms=round((time.perf_counter()-started)*1000)
for line in sys.stdin:
 try:
  req=json.loads(line);beg=time.perf_counter();raw=agent.system_one(req['state'],laya_questions(req['questions']));answers=[convert_answer(q,raw['answers'][q['id']]) for q in req['questions']];infer_ms=round((time.perf_counter()-beg)*1000,2)
  print(json.dumps({'schemaVersion':'fs.decision.result.v1','provider':'laya-shadow-warm','answers':answers,'evidence':{'stateSchemaVersion':req['state']['schemaVersion'],'providerVersion':'pinned-v0.3.6','policyVersion':'shadow-only','authoritative':False,'notes':['act_probability intentionally ignored.'], 'runtime':{'loadMs':load_ms,'inferenceMs':infer_ms}},'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}),flush=True)
 except Exception as e: print(json.dumps({'schemaVersion':'fs.decision.worker.error.v1','error':str(e)}),flush=True)
