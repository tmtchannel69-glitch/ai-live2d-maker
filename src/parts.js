import catalog from '../shared/parts.json';
export const TEMPLATES = catalog;
export const BASIC_IDS = catalog.basic.map(part => part.id);
export const ALL_IDS = Object.values(catalog).flat().map(part => part.id);
export const PART_LABELS = Object.fromEntries(Object.values(catalog).flat().map(part => [part.id,part.name]));
export const partTemplate = id => BASIC_IDS.includes(id) ? 'basic' : 'production';
export const defaultTemplates = () => ({basic:{mode:'demo',selected:[...BASIC_IDS]},production:{mode:'ai',selected:[]}});
