import test from 'node:test';import assert from 'node:assert/strict';import {readSnapshot,readDelta} from '../src/read-delta.js';
test('unchanged file ranges can avoid retransmitting identical content',()=>{const s=readSnapshot('hello',0,10),d=readDelta(s.sha256,s);assert.equal(d.changed,false);assert.equal(d.content,'')});
test('changed content is returned with a new integrity hash',()=>{const a=readSnapshot('a',0,10),b=readSnapshot('b',0,10),d=readDelta(a.sha256,b);assert.equal(d.changed,true);assert.equal(d.content,'b');assert.notEqual(d.sha256,a.sha256)});
