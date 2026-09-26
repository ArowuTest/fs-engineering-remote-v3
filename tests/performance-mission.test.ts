import test from 'node:test';import assert from 'node:assert/strict';import {missionPerformance} from '../src/performance-mission.js';
const e=(missionId:string,operation:string,at:string,durationMs:number):any=>({missionId,operation,at,durationMs,requestBytes:10,responseBytes:100,phase:'tool',ok:true});
test('mission performance quantifies server handler time versus outside/harness gaps',()=>{const r=missionPerformance([e('m','a','2026-01-01T00:00:00Z',100),e('m','b','2026-01-01T00:00:05Z',100)])[0];assert.equal(r.handlerMs,200);assert.equal(r.outsideMs,4900);assert.ok(r.outsideRatio>.95)});
