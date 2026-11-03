import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentOptions} from '../netlify/lib/payment-options.mts';
test('cash is limited to strictly below 12 km',()=>{
  assert.equal(validatePaymentOptions({payment_method:'cash'},11999.999).method,'cash');
  assert.throws(()=>validatePaymentOptions({payment_method:'cash'},12000));
  assert.throws(()=>validatePaymentOptions({payment_method:'cash'},24000));
  assert.equal(validatePaymentOptions({},24000).method,'dispatch');
});
test('counteroffers are pending and limited to strictly below 24 km',()=>{
  assert.deepEqual(validatePaymentOptions({counter_offer:'45.50'},23999.99),{method:'dispatch',offer:45.5,status:'pending'});
  assert.throws(()=>validatePaymentOptions({counter_offer:'45.50'},24000));
  assert.deepEqual(validatePaymentOptions({payment_method:'cash',counter_offer:'20'},5000),{method:'cash',offer:20,status:'pending'});
});
test('invalid amounts and unsupported payment methods are rejected',()=>{
  for(const offer of ['0','-1','1.001','Infinity','1e5',NaN,100,{},true])assert.throws(()=>validatePaymentOptions({counter_offer:offer},1000));
  assert.throws(()=>validatePaymentOptions({payment_method:'paid'},1000));
  assert.equal(validatePaymentOptions({counter_offer:null},1000).status,'none');
});
