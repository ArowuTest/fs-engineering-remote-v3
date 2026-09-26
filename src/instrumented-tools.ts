import path from 'node:path';import {measurePerformance} from './performance-telemetry.js';
export interface ToolInstrumentation{stateRoot:string;missionId?:string}
export function instrumentTool<TInput,TOutput>(name:string,options:ToolInstrumentation,handler:(input:TInput)=>Promise<TOutput>){return async(input:TInput)=>measurePerformance({file:path.join(options.stateRoot,'performance','mcp-events.jsonl'),missionId:options.missionId,operation:name,phase:'tool',request:input},()=>handler(input))}
