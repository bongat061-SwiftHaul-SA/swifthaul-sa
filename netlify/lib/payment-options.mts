import {RouteError} from './delivery.mts';
export function validatePaymentOptions(body:Record<string,unknown>,distance:number){
  const method=body.payment_method ?? 'dispatch';
  if(method!=='cash' && method!=='dispatch')throw new RouteError('Choose cash or payment through dispatch.',400);
  if(method==='cash' && distance>=12000)throw new RouteError('Cash payment is available only for mapped routes below 12 km.',400);
  const raw=body.counter_offer;
  let offer:number|null=null;
  if(raw!==undefined && raw!==null && raw!==''){
    if(distance>=24000)throw new RouteError('Counteroffers are available only for mapped routes below 24 km.',400);
    if(typeof raw!=='string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(raw) || Number(raw)<=0)throw new RouteError('Enter a positive counteroffer in rand with no more than two decimal places.',400);
    offer=Number(raw);
  }
  return {method,offer,status:offer===null?'none':'pending'};
}
