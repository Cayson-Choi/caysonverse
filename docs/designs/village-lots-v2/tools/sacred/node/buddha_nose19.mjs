import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { MeshoptEncoder } from "meshoptimizer";

// Local sculpt coordinates in millimetres. X is lateral, Y is up and Z is anterior.
const axis = -.004;
const base = 1.595;
const clamp = t => Math.max(0, Math.min(1, t));
const mix = (a, b, t) => a + (b-a)*t;
function step(lo, hi, x) {
  const t = clamp((x-lo)/(hi-lo));
  return t*t*(3-2*t);
}
const unit = v => {
  const length = Math.hypot(...v);
  return v.map(x => x/length);
};
const blend = (a,b,t) => a.map((x,k) => mix(x,b[k],t));

function join(a,b,width) {
  const t = Math.max(width-Math.abs(a-b),0)/width;
  return Math.min(a,b) - .25*width*t*t;
}

// Tucked under the medial, forward-facing quarter of each wing.
function naris(x,y,z) {
  const along = .82*(Math.abs(x)-25) - .57*(z-64.8);
  const across = .57*(Math.abs(x)-25) + .82*(z-64.8);
  return Math.exp(-((along/11.0)**2 + (across/7.4)**2 + ((y+9.3)/4.7)**2));
}

function surface(x,y,z) {
  const u = Math.abs(x);
  const cheek = (z-(51.3+.48*y-.21*u))*.88;
  const root = 19*(Math.hypot(x/21,(y-35)/43,(z-62)/28)-1);
  const tip = 20*(Math.hypot(x/19.8,(y-2.5)/20.2,(z-75.2)/21.5)-1);
  const wing = 17*(Math.hypot((u-26.0)/16.6,(y-5.4)/20.6,(z-58.2)/17.8)-1);
  const cast = join(join(cheek,root,11),tip,9);
  return join(cast,wing,9.4) + 3.0*naris(x,y,z);
}

function weight(x,y,z) {
  const u=Math.abs(x);
  return (1-step(40,50,u))*(1-step(21,30,y))
    *step(-24,-17,y)*Math.max(step(-13,-6,y),step(58,68,z))*step(37,49,z)
    *(1-step(30,42,u)*step(19,26,y));
}

function castPoint(p) {
  // Ray from within the original cast. Take the outermost intersection, which
  // includes the overhang under the tip and the return under the alar rim.
  const origin = [0,2,25];
  const ray = unit(p.map((v,k) => v-origin[k]));
  const at = t => origin.map((v,k) => v+ray[k]*t);
  let outside = 85;
  while (outside>1 && surface(...at(outside-1))>0) outside--;
  let lo=outside-1, hi=outside;
  for (let j=0;j<13;j++) {
    const t=(lo+hi)/2;
    if (surface(...at(t))>0) hi=t;
    else lo=t;
  }
  return at((lo+hi)/2);
}

function gradient(p) {
  const h=.15;
  return unit(p.map((v,k) => {
    const a=[...p], b=[...p];
    a[k]=v+h; b[k]=v-h;
    return surface(...a)-surface(...b);
  }));
}

// Each alar wall runs obliquely from the forward lobule into the cheek.
// Its tangent axis is visible from both cameras. An aperture cut along
// this surface therefore has a finite length in both views.
const diag=Math.SQRT1_2;
function wingForm(s,y) {
  const r=Math.hypot(s/22.0,(y-2.4)/17.9);
  const dome=r<1 ? (1+Math.cos(Math.PI*r))*.5 : 0;
  const collar=Math.exp(-(((r-.98)/.20)**2));
  const hole=Math.exp(-(((s-.3)/7.2)**2 + ((y+9.0)/3.8)**2));
  const q=64.7+.18*y+8.9*dome-1.6*collar-3.4*hole;
  return {r,hole,q};
}
function wingPoint(p) {
  const [x,y,z]=p,u=Math.abs(x);
  const s=(u-z+38.5)*diag;
  const drop=4.0*Math.exp(-((s/20)**2+((y+2)/14)**2));
  const height=y-drop;
  const {r,q,hole}=wingForm(s,height);
  const w=(1-step(1.03,1.53,r))*step(10,19,u)*step(40,49,z);
  const dq=q-(u+z)*diag;
  const point=[x+Math.sign(x)*diag*dq,height,z+diag*dq];
  const h=.1;
  const ds=(wingForm(s+h,height).q-wingForm(s-h,height).q)/(2*h);
  const dh=(wingForm(s,height+h).q-wingForm(s,height-h).q)/(2*h);
  const normal=unit([Math.sign(x)*diag*(1-ds),-dh,diag*(1+ds)]);
  return {point,normal,w,hole,s,height};
}

// Fair the long decimation triangles across the roll, with a fixed boundary.
function relax(samples,indices) {
  for (let i=0;i<indices.length;i+=3) {
    for (let k=0;k<3;k++) {
      const a=samples.get(indices[i+k]), b=samples.get(indices[i+(k+1)%3]);
      if (a && b) {a.neighbours.add(b); b.neighbours.add(a);}
    }
  }
  for (let pass=0;pass<4;pass++) {
    const next=new Map();
    for (const s of samples.values()) {
      const local=s.w*Math.max(s.tip,s.wing.w);
      if (local<.1 || s.neighbours.size<3) continue;
      const mean=[0,0,0], norm=[0,0,0];
      let mass=0;
      for (const other of s.neighbours) {
        const d=Math.hypot(...other.point.map((v,k)=>v-s.point[k]));
        const weight=1/Math.max(3,d);
        mass+=weight;
        other.point.forEach((v,k)=>mean[k]+=v*weight);
        other.norm.forEach((v,k)=>norm[k]+=v*weight);
      }
      next.set(s,[blend(s.point,mean.map(v=>v/mass),.39*local),
        unit(blend(s.norm,norm.map(v=>v/mass),.42*local))]);
    }
    for(const [sample,[point,norm]] of next) Object.assign(sample,{point,norm});
  }
}

function gilt(p,uv,wing) {
  const [x,y,z]=p, u=Math.abs(x);
  const bulb=Math.exp(-((u/14)**2 + ((y-0.5)/13)**2))*step(72,90,z);
  const outer=step(13,25,u)*(1-step(35,46,u))*step(45,54,z);
  const oldLine=Math.exp(-(((uv[1]-.570)/.028)**2));
  const mapped=[uv[0],uv[1]-.017*bulb-.017*oldLine*outer];
  // Register the short dark turn under the wing in both views. Higher on
  // the outer wall, the shading follows the curved return of the casting.
  const ring=Math.hypot((z-59.7)/15.9,(y-4.2)/17.0);
  const groove=Math.exp(-(((ring-1)/.25)**2))*step(19,34,u)
    *step(-.6,.3,(y-4.2)/17-(z-59.7)/15.9);
  const mid=blend(mapped,[.75+Math.sign(x)*.023,.554],.40*groove);
  const s=wing.s-.3, t=wing.height+9;
  const aperture=[(x>0?.783:.729)+Math.sign(x)*.0018*s,
    Math.min(.608,.580-.00145*s-.00435*t)];
  const footprint=Math.hypot(s/10,t/6);
  return blend(mid,aperture,wing.w*(1-step(.45,2.15,footprint)));
}

function sideReflection([x,y,z],uv) {
  const u=Math.abs(x), s=(z-64)/13.7, t=(y-5.8)/16.6;
  const r=Math.hypot(s,t);
  const side=step(19,33,u)*(1-step(47,58,u))*step(-10,-3,y);
  const arc=Math.exp(-(((r-.99)/.31)**2))*step(-.55,.44,t-.80*s);
  const pad=Math.exp(-(((s-.08)/.79)**2+((t-.12)/.71)**2));
  const column=x<0?.728:.783;
  const light=blend(uv,[column,.516],.39*side*pad);
  return blend(light,[column,.553],.48*side*arc);
}

function rearRim([x,y,z],wing,uv) {
  const t=step(2,12,wing.s)*Math.exp(-(((y+8.0)/6.2)**2+((z-58)/9.6)**2));
  return blend(uv,[x>0?.810:.697,.537],.80*t);
}

function replace(parts,view,bytes) {
  const ext=view.extensions.EXT_meshopt_compression;
  const encoded=MeshoptEncoder.encodeGltfBuffer(bytes,ext.count,ext.byteStride,ext.mode,0);
  parts.set(view,bytes);
  parts.set(ext,Buffer.from(encoded));
}

export function sculptLowerNose({doc,binary},lod) {
  const [mesh]=doc.meshes, [skin]=mesh.primitives;
  assert.equal(mesh.primitives.length,1);
  assert.equal(doc.materials[skin.material].name,"Main Buddha gold leaf");
  assert.equal(doc.images.length,4);
  const position=doc.accessors[skin.attributes.POSITION], view=doc.bufferViews[position.bufferView];
  const fill=doc.bufferViews[doc.accessors[skin.attributes.TEXCOORD_1].bufferView];
  assert.equal(view.byteStride,32);
  assert.equal(fill.byteStride,4);
  const data=Buffer.from(binary.subarray(view.byteOffset,view.byteOffset+view.byteLength));
  const fillUv=Buffer.from(binary.subarray(fill.byteOffset,fill.byteOffset+fill.byteLength));
  const sourceHash={pc:"73faa07b78373a247f2a21bc6439a915b384c6859fda08b6bb463e9743b36568",
    phone:"5ce2a226edafe4c83aa1635c3279f820cf1c2724765348dbc25b2eb9375e571e"};
  assert.equal(createHash("sha256").update(data).digest("hex"),sourceHash[lod],
    "Use the pass-18 cast from 9aafa326");
  const samples=new Map();
  for (let i=0;i<position.count;i++) {
    const row=Array.from({length:8},(_,k)=>data.readFloatLE(i*32+k*4));
    if (row[6]<.5) continue;
    const p=[(row[0]-axis)*1000,(row[1]-base)*1000,row[2]*1000];
    const w=weight(...p);
    if (!w) continue;
    const tip=(1-step(13,24,Math.abs(p[0])))*step(59,77,p[2]);
    const target=castPoint(p);
    const wing=wingPoint(p);
    target[0]*=1+.14*(1-step(-10,6,target[1]));
    const ball=.43*step(44,64,p[2]);
    const alarPoint=blend(wing.point,target,ball);
    const tipNormal=gradient(target);
    const alarNormal=unit(blend(wing.normal,tipNormal,ball));
    const point=blend(blend(p,target,tip),alarPoint,wing.w);
    const norm=blend(blend(row.slice(3,6),tipNormal,tip),alarNormal,wing.w);
    samples.set(i,{row,p,w,point:blend(p,point,w),norm,wing,tip,neighbours:new Set()});
  }
  const acc=doc.accessors[skin.indices], ib=doc.bufferViews[acc.bufferView];
  assert.equal(acc.componentType,5123);
  relax(samples,new Uint16Array(binary.buffer,binary.byteOffset+ib.byteOffset,acc.count));
  for(const [i,sample] of samples) {
    const {row,p,w,norm,wing,tip}=sample;
    if (!tip && !wing.w) continue;
    // Keep the folded underside parametrization. The old cast has multiple
    // layers at this height; projecting them all onto a sphere pinches the rim.
    const floor=(1-step(-13,-5,p[1]))*(1-step(13,23,Math.abs(p[0])));
    const oldFloor=[p[0]*(1+.065*step(58,76,p[2])),
      p[1]+2.2*step(57,72,p[2]),p[2]];
    const point=blend(sample.point,oldFloor,w*floor);
    // Fit the eye-registered outer alar span and the narrower horizontal cut
    // four photograph pixels above the central foot.
    point[0]*=1-w*Math.max(tip,wing.w)*(.035+.062*Math.exp(-(((point[1]+7.5)/7.2)**2)));
    const [x,y,z]=point;
    const wall=unit([Math.sign(x)*.3,-.83,-.45]);
    const castNormal=blend(norm,wall,.62*wing.hole*wing.w);
    const normal=unit(blend(row.slice(3,6),castNormal,w*(1-.87*floor)));
    const original=row.slice(6);
    const target=rearRim(point,wing,gilt(point,original,wing));
    const result=[axis+x/1000,base+y/1000,z/1000,...normal,...blend(original,target,w*Math.max(tip,wing.w))];
    result.forEach((v,k)=>data.writeFloatLE(v,32*i+4*k));
    const lightUv=[0,1].map(k=>fillUv.readUInt16LE(4*i+2*k)/65535);
    const light=rearRim(point,wing,sideReflection(point,gilt(point,lightUv,wing)));
    for(let k=0;k<2;k++) {
      const off=i*4+k*2;
      fillUv.writeUInt16LE(Math.round(mix(fillUv.readUInt16LE(off),light[k]*65535,w*Math.max(tip,wing.w))),off);
    }
  }
  const parts=new Map();
  replace(parts,view,data);
  replace(parts,fill,fillUv);
  console.log(lod,samples.size,"lower nasal vertices");
  return parts;
}
