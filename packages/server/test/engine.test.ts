import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schedule, delay, repair, type Kitchen, type Plan, type Step, type Dish } from '../src/engine.js';
import { defaultOven } from '@one-oven/contracts';
import { verify } from '../src/engine/verify.js';
import { dishes, dish } from '../src/dishes.js';
const kitchen:Kitchen={ovens:[defaultOven()],burners:4,helpers:1,timezone:'America/Chicago'};
// Independent sweep over every interval between endpoints, not the placement predicate.
export function check(steps:Step[],k:Kitchen,serve:number) {
  verify(steps,k,serve);
}
const make=(steps:Step[]):Plan=>({plan_id:'p',kitchen_id:'k',kitchen,version:1,serve:1000,steps,household_id:'local',serve_requested:1000,oven_segments:[],warnings:[],created_at:0,updated_at:0,schema:2});
for(const [name,ids] of [['weekday',['salmon','rice','green-beans']],['oven conflict',['turkey','salmon','potatoes']],['Thanksgiving eight dishes',dishes.map(d=>d.dish_id)]] as const) {
  test(name,()=>{const steps=schedule(ids.map(dish),kitchen,1000);check(steps,kitchen,1000);assert.equal(Math.max(...steps.map(s=>s.end)),1000);assert.deepEqual(schedule(ids.map(dish),kitchen,1000),steps);});
}
test('oven compatibility uses full temperature range, not transitive pairs',()=>{
  const data=[350,375,400].map((temperature,i):Dish=>({...dish('potatoes'),dish_id:`d${i}`,name:'oven',course:'side',steps:[{text:'Bake the food.',kind:'oven',minutes:10,hands:0,burners:0,temperature_f:temperature,oven_units:1}]}));
  check(schedule(data,kitchen,100),kitchen,100);
  const two={...kitchen,ovens:[defaultOven(),defaultOven()]}; const steps=schedule(data,two,100);check(steps,two,100); assert.ok(steps.filter(s=>s.source==='recipe').every(s=>s.end===100));
});
test('burner and hands constraints at capacity one',()=>{const k={...kitchen,burners:1};check(schedule(dishes,k,1000),k,1000);});
test('delay preserves completed steps and running start; changes propagate only as needed',()=>{
  const p=make(schedule(['salmon','rice','green-beans'].map(dish),kitchen,1000));
  const prep=p.steps.find(s=>s.step_id==='salmon:0')!;prep.status='done';
  const roast=p.steps.find(s=>s.step_id==='salmon:1')!;roast.status='running';
  for (const s of p.steps) if (s.dish_id !== 'salmon' && s.start < roast.start) s.status = s.end <= roast.start ? 'done' : 'running';
  const old=structuredClone(p);const revised=delay(p,'salmon',5,roast.start);
  check(revised.steps,kitchen,revised.serve);
  assert.equal(revised.serve,1005);assert.equal(revised.version,2);
  assert.deepEqual(revised.steps.find(s=>s.step_id===prep.step_id),prep);
  assert.equal(revised.steps.find(s=>s.step_id===roast.step_id)!.start,roast.start);
  assert.equal(revised.steps.find(s=>s.step_id===roast.step_id)!.end,roast.end+5);
  assert.deepEqual(revised.steps.filter(s=>s.dish_id!=='salmon'),p.steps.filter(s=>s.dish_id!=='salmon'));
  assert.deepEqual(p,old,'caller is not mutated');
});
test('delay propagates a resource collision without overlapping hands',()=>{
  const one=(id:string):Dish=>({...dish('gravy'),dish_id:id,name:id,course:'side',steps:[{text:'Stir the food.',kind:'stove',minutes:5,hands:1,burners:1}]});
  const p=make(schedule([one('a'),one('b')],kitchen,1000));
  const revised=delay(p,'b',5,900);check(revised.steps,kitchen,revised.serve);
  assert.equal(revised.steps.find(s=>s.dish_id==='a')!.start,1000);
});
test('frozen conflict rejects atomically',()=>{
  const steps=schedule([dish('gravy'),dish('carrots')],kitchen,1000);
  steps.forEach(s=>s.status='running'); const p=make(steps);const before=structuredClone(p);
  assert.throws(()=>delay(p,steps[0].dish_id!,180,800));assert.deepEqual(p,before);
});
test('rejects invalid delays, completed dishes and impossible kitchens',()=>{
  const p=make(schedule([dish('salmon')],kitchen,1000));
  for(const minutes of [0,-1,1.5,181]) assert.throws(()=>delay(p,'salmon',minutes,900));
  p.steps.forEach(s=>s.status='done');assert.throws(()=>delay(p,'salmon',5,900));
  assert.throws(()=>schedule([dish('salmon')],{...kitchen,ovens:[]},1000));
  assert.throws(()=>schedule([dish('rice'),dish('rice')],kitchen,1000));
});
test('clock floor prevents moving pending work into the past',()=>{
  const steps=schedule([dish('rice')],kitchen,1000);const revised=repair(steps,kitchen,1000);check(revised,kitchen,1100);assert.ok(revised.every(s=>s.start>=1000));
});
test('deterministic scenario sweep across capacities and delay targets',()=>{
  for(const burners of [1,2,4]) for(const helpers of [1,2]) for(const ovens of [1,2]) {
    const k={...kitchen,burners,helpers,ovens:Array.from({length:ovens},defaultOven)};const steps=schedule(dishes,k,1000);check(steps,k,1000);
    for(const d of dishes) {const p={...make(steps),kitchen:k};const q=delay(p,d.dish_id,7,0);check(q.steps,k,q.serve);}
  }
});
