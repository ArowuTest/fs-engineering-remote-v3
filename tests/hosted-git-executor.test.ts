import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { HostedGitExecutor } from '../src/hosted-git-executor.js';
test('hosted git executor rejects main',async()=>{await assert.rejects(()=>new HostedGitExecutor().execute({repository:'ArowuTest/fs-engineering-remote-v3',branch:'main',commitMessage:'x',files:{}}),/not an allowed/)});
test('hosted git executor rejects unapproved repo before credentials',async()=>{await assert.rejects(()=>new HostedGitExecutor().execute({repository:'other/repo',branch:'feature/x',commitMessage:'x',files:{}}),/not allowed/)});


test('hosted git keeps GitHub token out of persisted remote URLs and verification environment',async()=>{
 const source=await fs.readFile(new URL('../src/hosted-git-executor.ts',import.meta.url),'utf8');
 assert.doesNotMatch(source,/x-access-token:\$\{encodeURIComponent\(token\)\}@github\.com/);
 assert.doesNotMatch(source,/const auth\s*=/);
 assert.doesNotMatch(source,/\['clone'[^\n]+\bauth\b/);
 assert.doesNotMatch(source,/env:NodeJS\.ProcessEnv=process\.env/);
 assert.match(source,/GIT_CONFIG_COUNT/,'git network commands should receive ephemeral auth config only');
 assert.match(source,/sanitizedCommandEnvironment/,'verification commands should use sanitized process environment');
});
