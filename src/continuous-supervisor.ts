import {MissionOrchestrator} from './orchestrator.js';
import {MissionManager} from './missions.js';
export const TRUE_STOP_STATES=new Set(['completed','failed','cancelled','blocked','blocked_churn','awaiting_approval','requirements_challenge']);
export class ContinuousEngineeringSupervisor{
 private stopped=false;
 constructor(private readonly missions:MissionManager,private readonly orchestrator:MissionOrchestrator,private readonly pollMs=1500){}
 stop(){this.stopped=true}
 async runMission(missionId:string,{maxCycles=1000}:{maxCycles?:number}={}){let last:any;for(let cycle=0;cycle<maxCycles&&!this.stopped;cycle++){last=cycle===0?await this.orchestrator.advance(missionId):await this.orchestrator.reconcile(missionId);const state=String(last?.state??'unknown');if(TRUE_STOP_STATES.has(state))return {...last,continuous:{stopped:true,reason:state,cycles:cycle+1}};if(state==='unknown')return {...last,continuous:{stopped:true,reason:'unknown_state',cycles:cycle+1}};await new Promise(r=>setTimeout(r,this.pollMs))}return {...last,continuous:{stopped:true,reason:this.stopped?'user_interrupt':'cycle_budget_exhausted',cycles:maxCycles}}}
}
