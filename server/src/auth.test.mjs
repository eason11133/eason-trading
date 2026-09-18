import test from 'node:test';import assert from 'node:assert/strict';import {apiAuthorized} from './auth.mjs';
test('local API authentication fails closed when token is missing',()=>{assert.equal(apiAuthorized('', ''),false);assert.equal(apiAuthorized('x',''),false);});
test('local API accepts only the exact configured token',()=>{const k='a'.repeat(64);assert.equal(apiAuthorized(k,k),true);assert.equal(apiAuthorized('b'.repeat(64),k),false);});
