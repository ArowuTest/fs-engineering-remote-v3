import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validateConfig } from '../src/config.js';
import { ProcessManager } from '../src/processes.js';
import { createRemoteOperations } from '../src/operations.js';
import { createOpenApiDocument } from '../src/openapi.js';

const compact: Record<string,{route:string,action:string}> = {
  patch_file:{route:'/actions/fs',action:'patch'}, search_repository:{route:'/actions/fs',action:'search'}, repository_map:{route:'/actions/fs',action:'map'}, applicable_instructions:{route:'/actions/fs',action:'instructions'},
  exec_list:{route:'/actions/process',action:'exec_list'}, exec_poll:{route:'/actions/process',action:'exec_poll'}, exec_write:{route:'/actions/process',action:'exec_write'}, exec_cancel:{route:'/actions/process',action:'exec_cancel'},
  git_worktree_list:{route:'/actions/git',action:'worktree_list'}, git_worktree_create:{route:'/actions/git',action:'worktree_create'}, git_worktree_remove:{route:'/actions/git',action:'worktree_remove'}, changed_since:{route:'/actions/git',action:'changed_since'},
  save_project_context:{route:'/actions/memory',action:'save_project_context'}, load_project_context:{route:'/actions/memory',action:'load_project_context'}, resume_project:{route:'/actions/memory',action:'resume_project'},
  run_engineering_check:{route:'/actions/engineering',action:'engineering_check'}, run_deployment:{route:'/actions/engineering',action:'deployment'}, docker_project_status:{route:'/actions/engineering',action:'docker_status'}, docker_project_logs:{route:'/actions/engineering',action:'docker_logs'}, evidence_bundle:{route:'/actions/engineering',action:'evidence_bundle'},
};

test('Codex-critical advertised capabilities are implemented in MCP and mapped into compact Actions/OpenAPI',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fs-cap-contract-'));const config=validateConfig({endpointSecret:'e'.repeat(48),actionsSecret:'a'.repeat(48),roots:[{name:'work',path:dir}]});const ops=createRemoteOperations(config,new ProcessManager({shell:'powershell.exe',maxOutputBytes:100000}));const caps:any=await ops.capabilities();
  const advertised=new Set<string>(Object.values(caps.tools).flatMap((x:any)=>Array.isArray(x)?x:[]));const server=await fs.readFile(new URL('../src/server.ts',import.meta.url),'utf8');const actions=await fs.readFile(new URL('../src/actions.ts',import.meta.url),'utf8');const api:any=createOpenApiDocument('https://example.test');
  for(const [tool,mapping] of Object.entries(compact)){assert.ok(advertised.has(tool),`${tool} must be advertised`);assert.match(server,new RegExp(`registerTool\\('${tool.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}'`),`${tool} must be registered in MCP`);assert.match(actions,new RegExp(`['\"]${mapping.action}['\"]`),`${tool} compact action must have a handler`);const values=api.paths[mapping.route].post.requestBody.content['application/json'].schema.properties.action.enum;assert.ok(values.includes(mapping.action),`${tool} compact action must be in OpenAPI`);}
});

