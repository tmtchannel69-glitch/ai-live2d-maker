// Inspect serialized additive deforms, not a second rig generator. Single
// control intervals use the exact quadratic signed area (including its minimum).
// Multi-control nodes additionally inspect every axis-knot combination/edge.
export function auditModularMeshes(model){
  const nodes=[];const walk=n=>{nodes.push(n);if(nodes.length>64)throw new Error('メッシュ検査のノード数を超えています。');n.children.forEach(walk);};walk(model.nodes);
  let triangles=0,intervals=0;
  for(const node of nodes.filter(n=>n.type==='Part')){
    const mesh=node.mesh,controls=model.param.flatMap(p=>p.bindings.filter(b=>b.node===node.uuid&&b.param_name==='deform').map(b=>({axis:p.axis_points[0],values:b.values.map(v=>v[0])})));
    if(controls.length>3)throw new Error('この共通リグの変形数に対応していません。');
    const at=(values,i)=>[mesh.verts[i*2]+values.reduce((s,v)=>s+v[i][0],0),mesh.verts[i*2+1]+values.reduce((s,v)=>s+v[i][1],0)];
    const cross=(values,ids)=>{const [a,b,c]=ids.map(i=>at(values,i));return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);};
    for(let j=0;j<mesh.indices.length;j+=3){
      const ids=mesh.indices.slice(j,j+3),base=cross([],ids);triangles++;if(base<=0)throw new Error('基準メッシュが折り返しています。');
      const check=v=>{if(!Number.isFinite(v)||v< -1e-6)throw new Error(node.name+'のメッシュが動作中に折り返します。配置・目元の形を確認してください。');};
      if(!controls.length)continue;
      // For each control interval, hold the others at every knot. This is an
      // exact 1D interval audit, not a proof of every 3D interior combination.
      for(let active=0;active<controls.length;active++){
        const selected=[];
        const visit=k=>{
          if(k<controls.length){if(k===active){visit(k+1);return;}for(const value of controls[k].values){selected[k]=value;visit(k+1);}return;}
          const c=controls[active];for(let a=0;a<c.values.length-1;a++){
            selected[active]=c.values[a];const start=cross(selected,ids);selected[active]=c.values[a+1];const end=cross(selected,ids);
            selected[active]=c.values[a].map((v,i)=>[(v[0]+c.values[a+1][i][0])*.5,(v[1]+c.values[a+1][i][1])*.5]);const mid=cross(selected,ids);
            const qa=2*(end+start-2*mid),qb=end-start-qa;check(start);check(end);check(mid);intervals++;
            if(qa>0){const t=-qb/(2*qa);if(t>0&&t<1)check(qa*t*t+qb*t+start);}
          }
        };visit(0);
      }
    }
  }
  return {triangles,checked_control_intervals:intervals,folds_detected:0,scope:'exact-single-axis-intervals-and-multi-axis-knot-edges',all_multi_axis_interiors_proven:false};
}
