import { DomainError, type Dish } from '@one-oven/contracts';
import { loadDishes } from './data/load.js';
export const dishes = loadDishes();
export function dish(id: string): Dish {
  const found = dishes.find(d => d.dish_id === id);
  if (!found) throw new DomainError('unknown_dish', 'That dish is unavailable. Choose a dish from the recipe list.');
  return found;
}
