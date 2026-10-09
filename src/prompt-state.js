export const MAX_POINTS = 32;
export function hasUsablePrompt(prompt) {
  return Boolean(prompt?.box || prompt?.points?.some(point => point.label === 1));
}
export function promptSignature(prompt) {
  return JSON.stringify(prompt || {});
}

// Independent histories prevent undo on one part from changing another part.
export function createPromptState(onChange) {
  let prompts = {}, undo = {}, redo = {};
  const copy = value => structuredClone(value);
  function commit(id, value) {
    if (promptSignature(value) === promptSignature(prompts[id])) return;
    (undo[id] ||= []).push(copy(prompts[id] || {}));
    if (undo[id].length > 100) undo[id].shift();
    redo[id] = [];
    prompts[id] = copy(value); onChange();
  }
  return {
    get prompts() { return copy(prompts); },
    addPoint(id, point) {
      const value = copy(prompts[id] || {});
      if ((value.points || []).length >= MAX_POINTS) return false;
      (value.points ||= []).push(point); commit(id,value); return true;
    },
    setBox(id, box) { commit(id, { ...prompts[id], box }); },
    clearPart(id) { commit(id, {}); },
    undo(id) {
      if (!undo[id]?.length) return;
      (redo[id] ||= []).push(copy(prompts[id] || {}));
      prompts[id] = undo[id].pop(); onChange();
    },
    redo(id) {
      if (!redo[id]?.length) return;
      (undo[id] ||= []).push(copy(prompts[id] || {}));
      prompts[id] = redo[id].pop(); onChange();
    },
    canUndo(id) { return Boolean(undo[id]?.length); },
    canRedo(id) { return Boolean(redo[id]?.length); },
    reset() { prompts = {}; undo = {}; redo = {}; onChange(); },
  };
}
