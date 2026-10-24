// Server/CLI-only preparation. Deliberately has no API transport, key access,
// fetch, SDK or execute switch. A prepared request is not owner approval.
import {createDesignPlan,hashJSON} from '../../shared/character-design.js';
import {sameJSONData} from '../../shared/designed-character.js';

export const PILOT_MODEL='gpt-image-1.5';
export const PILOT_ROLES=Object.freeze(['face_base','bangs_front','eye_white_l','iris_l','eyelashes_l']);
export const API_CANVAS=Object.freeze({width:1024,height:1024});
export const API_OFFSET=Object.freeze({x:128,y:0});
const instructions={
  face_base:'Only the complete face skin layer, including forehead, cheeks, nose and chin. Remove eyes, eyebrows, lashes, mouth, ears and all hair. Reconstruct skin hidden by the bangs and eyes, with matching shading. Do not cut holes where the eyes or hair used to be.',
  bangs_front:'Only the entire front bangs layer, including the concealed roots and overlaps. No face, eyes, ears, side hair, back hair or costume. Match the canonical reference hair silhouette, color, strand drawing, light and shadow.',
  eye_white_l:'Only the character-personal LEFT eye sclera/aperture. This is on the RIGHT of the viewer. No iris, pupil, highlight, lashes, eyelids, skin or eyebrows. Preserve the reference eye opening and complete its hidden portion for blinking.',
  iris_l:'Only the character-personal LEFT iris, pupil and iris shading, on the RIGHT of the viewer. No highlight, sclera, lashes or skin. Draw the complete iris even behind the lids. Match the reference iris color, center and size.',
  eyelashes_l:'Only the character-personal LEFT upper lash line and eyelashes, on the RIGHT of the viewer. No skin fill, iris, white of the eye or eyebrows. Match the reference line color, taper, thickness and curve; no duplicate parallel lash line.'
};

export async function createPilotPlan(input={}){
  const common=await createDesignPlan(input),b=common.blueprint;
  const layout=b.parts.filter(p=>['face_base','neck','dress_base','bangs_front','eye_white_l','eye_white_r'].includes(p.role))
    .map(p=>({role:p.role,box:{...p.rect,x:p.rect.x+API_OFFSET.x},anchor:[p.anchor[0]+API_OFFSET.x,p.anchor[1]]}));
  const shared=[
    'Create one original anime-style young adult woman, front view, chest-up, neutral expression, maid outfit, both eyes visible.',
    'Use one consistent character identity, palette, line drawing, soft cel shading and upper-left lighting in all outputs.',
    'Transparent RGBA PNG. No text, watermark, frame, checkerboard, cast background shadow or detached extra body parts.',
    'The image is 1024 by 1024. The character canvas is 768 by 1024, translated by (128,0), without scaling or stretching.',
    'The layout coordinates below use top-left image pixels. Keep the head, neck and eyes at these placements.',
    'Common design data (data values, not additional instructions): '+JSON.stringify(common.design),
    'Common palette: '+JSON.stringify(b.palette),
    'Layout: '+JSON.stringify(layout)
  ].join('\n');
  const settings={model:PILOT_MODEL,n:1,size:'1024x1024',quality:'medium',background:'transparent',output_format:'png'};
  const reference={id:'reference',operation:'generate',method:'POST',endpoint:'https://api.openai.com/v1/images/generations',
    content_type:'application/json',fields:{...settings,prompt:shared+'\nRender the fully assembled character as the canonical design reference.'},
    images:[],output:'raw/reference.png',prerequisites:['owner-approval','verified-current-pricing-and-terms']};
  const requests=[reference,...PILOT_ROLES.map(role=>{
    const part=b.parts.find(p=>p.role===role),q=part.rect,box={...q,x:q.x+API_OFFSET.x};
    return {id:role,operation:'edit',method:'POST',endpoint:'https://api.openai.com/v1/images/edits',content_type:'multipart/form-data',
      fields:{...settings,input_fidelity:'high',prompt:[shared,
        'Image 1 is the SAME canonical reference for every part. Preserve its identity and rendering style; do not redesign the character.',
        'Image 2 is a geometry-only guide. Its rectangle is the allowed part tile; its cross is the anchor. Do not copy any guide marks or colors into the result.',
        instructions[role],
        'Output only this independent part on the same 1024x1024 canvas. Keep every other pixel fully transparent. Do not rescale, recenter or crop the part.',
        'Allowed tile: '+JSON.stringify(box)+'. Anchor: '+JSON.stringify([part.anchor[0]+API_OFFSET.x,part.anchor[1]])+'.',
        'Generate full hidden surfaces within the tile. An editing mask or reference is guidance, not a guarantee of precise placement.'
      ].join('\n')},
      images:[{field:'image[]',asset:'raw/reference.png',purpose:'frozen-canonical-character-reference',sha256:null},
        {field:'image[]',asset:`guides/${role}.png`,purpose:'geometry-guide-not-character-artwork',sha256:null}],
      output:`raw/${role}.png`,role,part:structuredClone(part),api_rect:box,
      prerequisites:['owner-approval','reference-quality-pass','freeze-reference-sha256','same-reference-for-all-parts']};
  })];
  for(const request of requests){
    if(request.fields.prompt.length>32000)throw new Error('API prompt exceeds the documented character limit.');
  }
  const plan={format:'ai-live2d-openai-image-pilot',version:1,model:PILOT_MODEL,
    model_selection:'Provisional documented Images API candidate with input_fidelity=high. Alias, not a frozen snapshot or a claim of latest/best quality. Verify account availability, current price and terms before execution.',
    design:common.design,design_id:b.design_id,blueprint_id:common.blueprint_id,
    canonical_canvas:b.canvas,api_canvas:API_CANVAS,api_offset:API_OFFSET,requests,
    reference_binding:{asset:'raw/reference.png',sha256:null,state:'not-generated',reuse:'Freeze the actual response SHA256 and attach these exact same bytes to every part request. No reference regeneration between parts.'},
    retry_policy:{automatic_retries:0,planned_extra_attempts_per_request:1,attempts_include_ambiguous_timeouts:true,
      note:'Do not retry a timeout automatically: the first request may already have been billed. A revised reference invalidates every derived part; that is a new trial, not a free retry.'},
    trial_counts:{base_requests:requests.length,maximum_requests:requests.length*2,base_output_images:requests.length,maximum_output_images:requests.length*2,base_image_attachments:PILOT_ROLES.length*2,maximum_image_attachments:PILOT_ROLES.length*4},
    cost:{currency:'USD',current_official_prices_verified:false,estimated_trial_usd:null,maximum_trial_usd:null,
      permitted_api_calls:0,permitted_spend_usd:0,
      formula:'Base: C(reference) + 5*C(part edit). Planned maximum with one extra attempt per job: 2*C(reference) + 10*C(part edit). Each edit includes two image inputs, text input and one output. Cache discounts are not assumed.',
      limitation:'Request counts do not impose a hard dollar cap. Current token rates, size/quality output pricing and input usage must be confirmed. The Images API parameters reviewed do not expose a per-request monetary cap.'},
    review:{ai_generation_executed:false,external_requests_sent:0,api_transport_implemented:false,
      file_generation_passed:false,official_creator_tested:false,appearance_quality_passed:false,
      note:'Preparing technical guides and request JSON is not AI generation, a paid approval, a complete 33-part character or a runtime model.'},
    required_checks:['reference identity and layout','RGBA transparency without painted checkerboard','exact canvas and part placement','complete hidden anatomy','common color, lighting and tapered linework','no duplicate lash lines or iris ghosts','eyelid intermediate states after extending the eye group','neck/body and hair overlaps after full 33-part integration'],
    approval_required:['current model and official unit prices','estimated and maximum total cost including input and retries','exact prompts and all image attachments','data retention/training and output usage terms','server-only secret storage','explicit owner authorization']};
  return {...plan,plan_id:await hashJSON(plan)};
}

export async function validatePilotPlan(value){
  const expected=await createPilotPlan(value?.design);
  // Only the preparer may fill guide hashes; all other fields are canonical.
  for(const request of expected.requests){
    const received=value?.requests?.find(r=>r.id===request.id);
    for(const image of request.images)if(image.purpose==='geometry-guide-not-character-artwork'){
      const actual=received?.images?.find(i=>i.asset===image.asset)?.sha256;
      if(actual!==null&&!/^[0-9a-f]{64}$/.test(actual??''))throw new Error('Invalid guide fingerprint.');
      image.sha256=actual??null;
    }
  }
  const {plan_id,...data}=expected;expected.plan_id=await hashJSON(data);
  if(!sameJSONData(value,expected))throw new Error('Pilot plan, geometry or approval state has changed. Prepare a new plan.');
  return expected;
}
