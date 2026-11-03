import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withdrawalFee,nextBusinessDay,cents} from '../netlify/lib/wallet.mts';
test('cash-out fees use cents, include the fixed fee, and reject amounts below the fee',()=>{
 assert.equal(withdrawalFee(10000,'instant'),750);
 assert.equal(withdrawalFee(10000,'standard'),200);
 assert.equal(withdrawalFee(1000,'instant'),525);
 assert.throws(()=>withdrawalFee(500,'instant'));
 assert.throws(()=>withdrawalFee(200,'standard'));
 assert.throws(()=>withdrawalFee(1000,'unknown'));
});
test('standard processing skips weekends',()=>{
 assert.equal(nextBusinessDay(new Date('2026-10-30T10:00:00Z')),'2026-11-02T10:00:00.000Z');
 assert.equal(nextBusinessDay(new Date('2026-11-02T10:00:00Z')),'2026-11-03T10:00:00.000Z');
});
test('monetary conversion rejects negative, nonfinite and unsafe amounts',()=>{
 assert.equal(cents('12.50'),1250);
 assert.equal(cents('0.01'),1);
 for(const value of [-1,0,Infinity,NaN,'bad',1e18,1.0001,'12.0001',true,{},[10]])assert.throws(()=>cents(value));
});
