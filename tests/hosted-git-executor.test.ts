import test from 'node:test';
import assert from 'node:assert/strict';
import { HostedGitExecutor } from '../src/hosted-git-executor.js';
test('hosted git executor rejects main',async()=>{await assert.rejects(()=>new HostedGitExecutor().execute({repository:'ArowuTest/fs-engineering-remote-v3',branch:'main',commitMessage:'x',files:{}}),/not an allowed/)});
test('hosted git executor rejects unapproved repo before credentials',async()=>{await assert.rejects(()=>new HostedGitExecutor().execute({repository:'other/repo',branch:'feature/x',commitMessage:'x',files:{}}),/not allowed/)});
