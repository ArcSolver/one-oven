import { randomUUID } from 'node:crypto';
import { dish, dishes } from './dishes.js';
import { changes, delay, order, repair, schedule, type Kitchen, type Plan, type Step } from './engine.js';
import { Store } from './store.js';
export const iso = (minute: number) => new Date(minute * 60000).toISOString();
export class Service {
  constructor(readonly store: Store, readonly now = () => Math.ceil(Date.now()/60000)) {}
  setKitchen(k: Kitchen) { const kitchen_id = randomUUID(); this.store.saveKitchen(kitchen_id,k); return { kitchen_id, say:'Your kitchen is ready for a meal plan.', display:k }; }
  listDishes(course?: string, max?: number) {
    const list = dishes.filter(d => (!course || d.course === course) && (!max || d.steps.reduce((n,s)=>n+s.minutes,0)<=max)).map(d => ({dish_id:d.dish_id,name:d.name,active_min:d.steps.reduce((n,s)=>n+(s.hands?s.minutes:0),0),total_min:d.steps.reduce((n,s)=>n+s.minutes,0)}));
    return {dishes:list,say:`I found ${list.length} dishes for your kitchen.`,display:{dishes:list}};
  }
  planMeal(ids: string[], serveAt: string, kitchenId: string) {
    const serve = Date.parse(serveAt)/60000;
    if (!Number.isFinite(serve) || serve <= this.now() || serve > this.now()+10080) throw new Error('Choose a serving time within the next seven days, with a timezone.');
    const kitchen = this.store.kitchen(kitchenId);
    const steps = schedule(ids.map(dish),kitchen,serve);
    if (steps[0].start < this.now()) throw new Error(`There is not enough time. This meal needs to start at ${iso(steps[0].start)}.`);
    const p: Plan = {plan_id:randomUUID(),kitchen_id:kitchenId,kitchen,version:1,serve,steps};
    this.store.savePlan(p);
    return {...this.present(p),first_step:this.step(steps[0]),start_at:iso(steps[0].start),say:`Start at ${iso(steps[0].start)}. ${steps[0].text}`};
  }
  nextStep(id: string, done?: string) {
    const p = this.store.plan(id); const before = structuredClone(p.steps); const now=this.now();
    if(done) {
      const s=p.steps.find(s=>s.step_id===done);
      if(!s) throw new Error('Unknown step ID.');
      if(s.status==='done') return {...this.present(p),step:null,upcoming:[],say:'That step is already complete.'};
      if(s.status!=='running') throw new Error('Only a running step can be completed.');
      s.status='done'; s.end=now; s.minutes=s.end-s.start;
      if(s.minutes<0) throw new Error('The clock is earlier than the step start.');
    }
    // Repair before persisting a confirmation, including late completion conflicts.
    p.steps=repair(p.steps,p.kitchen,now);
    // Running steps require explicit completion; never infer done from wall time.
    if(p.steps.some(s=>s.status==='running' && s.end<=now)) {
      if (!done) throw new Error('A running step is overdue. Complete it or report its additional time first.');
      // Several passive steps may finish together; accept each confirmation separately.
      const changed=changes(before,p.steps);p.version++;p.serve=Math.max(p.serve,...p.steps.map(s=>s.end));
      this.store.savePlan(p);
      return {...this.present(p),step:null,upcoming:[],changed_steps:changed,say:'Step complete. Confirm the other finished steps or report their additional time.'};
    }
    const next=p.steps.filter(s=>s.status==='pending' && !p.steps.some(o=>o.dish_id===s.dish_id && o.index<s.index && o.status!=='done')).sort(order)[0];
    if(next && next.start<=now) next.status='running';
    const changed=changes(before,p.steps);
    if(changed.length) {p.version++;p.serve=Math.max(p.serve,...p.steps.map(s=>s.end));this.store.savePlan(p);}
    const upcoming=p.steps.filter(s=>s.status==='pending' && s!==next).sort(order).slice(0,2).map(s=>this.step(s));
    const say=next ? `${next.start>now?`At ${iso(next.start)}, `:''}${next.text}` : p.steps.some(s=>s.status==='running')?'Finish the steps already in progress, then tell me when they are done.':'All steps are complete. Your meal is ready.';
    return {...this.present(p),step:next?this.step(next):null,upcoming,changed_steps:changed,say};
  }
  reportDelay(id:string,dishId:string,minutes:number) {
    const old=this.store.plan(id); const p=delay(old,dishId,minutes,this.now()); this.store.savePlan(p);
    const changed=changes(old.steps,p.steps);
    return {...this.present(p),new_serve_at:iso(p.serve),changed_steps:changed,say:`Dinner is planned for ${iso(p.serve)}. ${changed.length} steps changed; the other steps stay as planned.`};
  }
  swapDish(id:string,oldId:string,replacement:string) {
    const old=this.store.plan(id);dish(replacement);
    const removed=old.steps.filter(s=>s.dish_id===oldId);
    if(!removed.length) throw new Error('That dish is not in this plan.');
    if(removed.some(s=>s.status!=='pending')) throw new Error('Only an unstarted dish can be replaced.');
    if(old.steps.some(s=>s.dish_id===replacement)) throw new Error('The replacement is already in this meal.');
    const added=schedule([dish(replacement)],old.kitchen,old.serve);
    const steps=repair([...old.steps.filter(s=>s.dish_id!==oldId),...added],old.kitchen,this.now());
    const p={...old,steps,version:old.version+1,serve:Math.max(old.serve,...steps.map(s=>s.end))}; this.store.savePlan(p);
    return {...this.present(p),changed_steps:changes(old.steps,steps),removed_step_ids:removed.map(s=>s.step_id),say:`The replacement is planned. Dinner is planned for ${iso(p.serve)}.`};
  }
  step(s:Step) {return {...s,start_at:iso(s.start),end_at:iso(s.end),resource:{hands:s.hands,burners:s.burners,oven:s.oven??null,temperature_f:s.temperature??null}};}
  present(p:Plan) {
    const holds=[...new Set(p.steps.map(s=>s.dish_id))].map(id=>({dish_id:id,ready_at:iso(Math.max(...p.steps.filter(s=>s.dish_id===id).map(s=>s.end))),hold_minutes:p.serve-Math.max(...p.steps.filter(s=>s.dish_id===id).map(s=>s.end))}));
    return {plan_id:p.plan_id,version:p.version,serve_at:iso(p.serve),say:`Dinner is planned for ${iso(p.serve)}.`,display:{steps:p.steps.map(s=>this.step(s)),dishes:holds},timer_suggestions:p.steps.filter(s=>s.status==='running').map(s=>({step_id:s.step_id,minutes:Math.max(0,s.end-this.now()),say:`Set a timer for ${Math.max(0,s.end-this.now())} minutes.`}))};
  }
}
