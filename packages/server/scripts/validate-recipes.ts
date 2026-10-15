import { loadDishes } from '../src/data/load.js';
const dishes = loadDishes();
console.log(`PASS: ${dishes.length} original recipes; schema and semantic validation.`);
