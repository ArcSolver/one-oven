import type { Dish, RecipeStep } from './engine.js';
const step = (text: string, minutes: number, hands = 0, burners = 0, temperature?: number): RecipeStep => ({ text, minutes, hands, burners, ...(temperature === undefined ? {} : { temperature }) });
// Original timing fixtures written for this project, not validated cooking instructions.
export const dishes: Dish[] = [
  { dish_id:'salmon', name:'Lemon salmon', course:'main', steps:[step('Season the salmon and prepare the tray.',4,1),step('Roast the salmon in the preheated oven.',18,0,0,400),step('Rest the salmon before serving.',3)] },
  { dish_id:'rice', name:'Fluffy rice', course:'side', steps:[step('Rinse the rice and fill the pot.',3,1),step('Bring the rice to a simmer.',4,1,1),step('Cook the covered rice gently.',15,0,1),step('Rest the covered rice off the burner.',5)] },
  { dish_id:'green-beans', name:'Green beans', course:'side', steps:[step('Trim the green beans.',4,1),step('Heat water for the beans.',5,0,1),step('Cook the beans.',5,0,1),step('Drain and season the beans.',2,1)] },
  { dish_id:'potatoes', name:'Roasted potatoes', course:'side', steps:[step('Cut and season the potatoes.',8,1),step('Roast the potatoes.',35,0,0,425),step('Rest the potatoes.',3)] },
  { dish_id:'turkey', name:'Turkey centerpiece', course:'main', steps:[step('Prepare the turkey tray.',15,1),step('Roast the turkey.',150,0,0,325),step('Rest the turkey.',30),step('Carve the turkey.',8,1)] },
  { dish_id:'stuffing', name:'Herbed stuffing', course:'side', steps:[step('Mix the stuffing.',8,1),step('Bake the stuffing.',30,0,0,350),step('Rest the stuffing.',5)] },
  { dish_id:'carrots', name:'Glazed carrots', course:'side', steps:[step('Slice the carrots.',5,1),step('Simmer the carrots.',12,0,1),step('Glaze the carrots.',3,1,1)] },
  { dish_id:'gravy', name:'Pan gravy', course:'side', steps:[step('Measure the gravy ingredients.',3,1),step('Whisk the gravy over heat.',7,1,1)] }
];
export function dish(id: string): Dish { const found = dishes.find(d => d.dish_id === id); if (!found) throw new Error(`Unknown dish: ${id}`); return found; }
