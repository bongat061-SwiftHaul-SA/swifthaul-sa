import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateLoad,calculateDeliveryFare} from '../netlify/lib/delivery.mts';
const parcel=(weight:number)=>({weight,length:1,width:1,height:1});
test('weight capacity boundaries select the vehicle and truck class',()=>{
  for(const [weight,vehicle,truckClass] of [[20,'bike',null],[20.001,'van',null],[1000,'van',null],[1000.001,'truck','4-ton'],[4000,'truck','4-ton'],[4000.001,'truck','8-ton'],[8000,'truck','8-ton']] as const){
    const load=calculateLoad(parcel(weight));assert.equal(load.vehicle,vehicle);assert.equal(load.truckClass,truckClass);
  }
  assert.throws(()=>calculateLoad(parcel(8000.001)));
});
test('large light consignments use volumetric weight',()=>{
  const load=calculateLoad({weight:1,length:100,width:100,height:100});
  assert.equal(load.volumetric,200);assert.equal(load.chargeable,200);assert.equal(load.vehicle,'van');assert.equal(load.weightFee,750);
});
test('included kilograms, proportional surcharges and distance bands compose correctly',()=>{
  for(const [weight,expected] of [[5,0],[5.5,4.25],[20,127.5],[50,0],[51,5],[1000,4750],[1001,0.45],[4000,1350],[4001,1500.5],[8000,3500]])assert.equal(calculateLoad(parcel(weight)).weightFee,expected);
  assert.equal(calculateDeliveryFare(parcel(6),11999).price,48.5);
  assert.equal(calculateDeliveryFare(parcel(6),12000).price,88.5);
  assert.equal(calculateDeliveryFare(parcel(6),24000).price,168.5);
});
test('invalid mass, dimensions and unsafe monetary totals are rejected',()=>{
  for(const value of [0,-1,NaN,Infinity,'5',null])assert.throws(()=>calculateLoad({...parcel(1),weight:value}));
  assert.throws(()=>calculateLoad({...parcel(1),height:0}));
  assert.throws(()=>calculateLoad({...parcel(1),length:100000,width:100000,height:100000}));
  assert.throws(()=>calculateDeliveryFare(parcel(8000),12000*45));
});
