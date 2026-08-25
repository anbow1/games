# Visual recipe — extracted verbatim from tank-battle/index.html (the reference)

Rules for every game:
- Three.js ES modules via the existing importmap (jsdelivr CDN). No external image/model assets — all textures are procedural `CanvasTexture` generated at load.
- Reuse geometry/material instances; no per-frame allocations in hot loops (reuse scratch Vector3/Matrix4/Color).
- Dynamic PointLights: pooled, ~6 max, decayed per frame. Everything else glows via emissive + bloom.
- `scene.fog` color MUST equal the sky shader horizon/haze color so fog blends into sky.
- 60 fps target on mid hardware: cap instanced counts, shadow map 2048 only for the sun.

## 1. Renderer setup (replace existing renderer config)
```js
renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
```

## 2. Post-processing chain (imports at top of module)
```js
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {GammaCorrectionShader} from 'three/addons/shaders/GammaCorrectionShader.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';

const composer=new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),0.5,0.6,0.8));
composer.addPass(new ShaderPass(GammaCorrectionShader));
const fxaaPass=new ShaderPass(FXAAShader);
composer.addPass(fxaaPass);
function sizeFXAA(){
  const pr=renderer.getPixelRatio();
  fxaaPass.material.uniforms["resolution"].value.set(1/(innerWidth*pr),1/(innerHeight*pr));
}
sizeFXAA();
```
Frame loop: call `composer.render()` instead of `renderer.render(...)`. Resize handler must also call `composer.setSize(innerWidth,innerHeight)` + `sizeFXAA()`.

## 3. Lighting (day)
```js
const hemi=new THREE.HemisphereLight(0xcfe4ff,0x5a5240,0.75);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff2d8,1.35);
sun.position.set(-320,420,-180);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.left=-130;sun.shadow.camera.right=130;
sun.shadow.camera.top=130;sun.shadow.camera.bottom=-130;
sun.shadow.camera.far=900;sun.shadow.bias=-0.0006;
scene.add(sun);scene.add(sun.target);
```
Adapt the shadow-camera box to your scene scale (city: ~±250 around play area).

## 4. Procedural sky dome (gradient + sun disc + drifting fbm clouds + self-shadow + cirrus)
Shared clock uniform used by sky (and any wind shaders): `const timeU={value:0};` — advance in frame loop: `timeU.value+=dt;`
```js
const SKY=0x9db8cc; // must equal scene.fog color family
scene.background=new THREE.Color(SKY);
scene.fog=new THREE.Fog(SKY,300,2300); // adapt near/far to scene scale

const skyMat=new THREE.ShaderMaterial({
  uniforms:{uTime:timeU,uSunDir:{value:new THREE.Vector3(-320,420,-180).normalize()}},
  side:THREE.BackSide,depthWrite:false,fog:false,
  vertexShader:`varying vec3 vW;void main(){vW=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vW,1.);}`,
  fragmentShader:`
 uniform vec3 uSunDir;uniform float uTime;varying vec3 vW;
 float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
 float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
 float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.03;a*=.5;}return v;}
 void main(){
  vec3 dir=normalize(vW-cameraPosition);
  float h=dir.y;
  vec3 hor=vec3(.40,.53,.63),zen=vec3(.10,.24,.50);
  vec3 col=mix(hor,zen,1.-exp(-max(h,0.)*3.2));
  if(h<0.)col=mix(hor,hor*vec3(.80,.78,.76),clamp(-h*4.,0.,1.));
  float sd=max(dot(dir,uSunDir),0.);
  col+=vec3(1.25,1.08,.82)*(pow(sd,900.)*4.+pow(sd,64.)*.22+pow(sd,8.)*.06);
  col+=vec3(.95,.58,.28)*pow(sd,3.)*smoothstep(.28,0.,h)*.2; // warm forward scatter low around sun
  if(h>0.01){
   vec2 uv=dir.xz/(h+.12)*.5;
   float cov=smoothstep(.30,.78,fbm(uv*.4+7.3));
   float n=fbm(uv*2.2+vec2(uTime*.008,uTime*.003));
   float a=smoothstep(.42,.7,n)*cov*smoothstep(.01,.12,h);
   vec3 cc=mix(vec3(.58,.60,.65),vec3(1.06,1.04,1.),clamp(pow(sd,2.)*.9+h*.5+fbm(uv*1.7)*.3,0.,1.));
   float sh=smoothstep(.32,.78,fbm(uv*2.2-vec2(uTime*.008,uTime*.003)+uSunDir.xz*1.6)); // cloud self-shadow
   cc=mix(cc*vec3(.52,.55,.62),cc,sh);
   col=mix(col,cc,clamp(a,0.,.85));
   float ci=fbm(vec2(uv.x*3.5,uv.y*.6)+vec2(uTime*.015,0.)); // high cirrus streaks
   vec3 cw=mix(vec3(.78,.84,.9),vec3(1.05,1.,.98),clamp(pow(sd,4.)*.7+.3,0.,1.));
   col=mix(col,cw,smoothstep(.55,.82,ci)*smoothstep(.15,.5,h)*.5);
  }
  col=mix(col,vec3(.62,.72,.80),smoothstep(.14,-.02,h)*.55); // horizon haze -> fog color
  gl_FragColor=vec4(col,1.);
 }`});
const sky=new THREE.Mesh(new THREE.SphereGeometry(2400,32,16),skyMat);
sky.frustumCulled=false;scene.add(sky);
```
Adapt: sphere radius > camera.far is fine (frustumCulled off) but keep < far plane; fog near/far to your scene; horizon haze vec3 must match `scene.fog` color.

## 5. Procedural texture patterns
Ground micro-detail (adapt palette for asphalt/concrete):
```js
function groundTex(){ // tiling dirt/grass micro-detail
  const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");
  g.fillStyle="#8a8f74";g.fillRect(0,0,256,256);
  for(let i=0;i<9000;i++){
    const x=Math.random()*256,y=Math.random()*256,t=Math.random();
    g.fillStyle=t<.5?`rgba(70,90,45,${Math.random()*.5})`:t<.8?`rgba(150,140,95,${Math.random()*.4})`:`rgba(90,75,55,${Math.random()*.35})`;
    g.fillRect(x,y,rand(1,2.6),rand(1,2.6));
  }
  for(let i=0;i<26;i++){ // worn patches
    const x=Math.random()*256,y=Math.random()*256,r=rand(8,30);
    g.globalAlpha=rand(.06,.16);g.fillStyle="#7a6f58";
    g.beginPath();g.ellipse(x,y,r,r*rand(.4,.9),rand(0,3),0,TAU);g.fill();
  }
  g.globalAlpha=1;
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(80,80);t.anisotropy=4;return t;
}
```
Worn painted metal (jets / vehicles):
```js
function wornTex(base){ // paint with weathering streaks, panel lines, chips
  const c=document.createElement("canvas");c.width=c.height=256;const g=c.getContext("2d");
  g.fillStyle=base;g.fillRect(0,0,256,256);
  for(let i=0;i<220;i++){
    g.globalAlpha=rand(.04,.11);g.fillStyle=Math.random()<.6?"#3a352c":"#d6cbb0";
    g.fillRect(rand(0,256),rand(0,80),rand(1,4),rand(30,256));
  }
  g.globalAlpha=.3;g.strokeStyle="rgba(0,0,0,.45)";
  for(let y=32;y<256;y+=32){g.beginPath();g.moveTo(0,y);g.lineTo(256,y);g.stroke();}
  for(let x=32;x<256;x+=64){g.beginPath();g.moveTo(x,0);g.lineTo(x,256);g.stroke();}
  g.globalAlpha=.5;
  for(let i=0;i<50;i++){g.fillStyle=Math.random()<.5?"rgba(60,52,40,.45)":"rgba(190,180,150,.3)";g.fillRect(rand(0,256),rand(0,256),rand(2,7),rand(1,4));}
  g.globalAlpha=1;
  return new THREE.CanvasTexture(c);
}
```
Soft radial sprite for ALL puffs/flames (one shared texture):
```js
function smokeTex(){
  const c=document.createElement("canvas");c.width=c.height=64;const g=c.getContext("2d");
  const gr=g.createRadialGradient(32,32,2,32,32,30);
  gr.addColorStop(0,"rgba(255,255,255,1)");gr.addColorStop(1,"rgba(255,255,255,0)");
  g.fillStyle=gr;g.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);
}
const SOFT_TEX=smokeTex();
```

## 6. Particle puffs + pooled flash lights (adapt ground clamp to your height fn or y>=0)
```js
const particles=[];
const flashPool=[];
function flashLight(pos,intensity,color){
  let l=flashPool.find(f=>!f.active);
  if(!l&&flashPool.length<6){l=new THREE.PointLight(0xffffff,0,120,1.8);l.active=false;scene.add(l);flashPool.push(l);}
  if(!l)return;l.active=true;l.position.copy(pos).add(new THREE.Vector3(0,1.5,0));
  l.intensity=intensity*60;l.color.set(color);
}
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){
    const p=particles[i];p.life-=dt;
    if(p.life<=0){scene.remove(p.mesh);particles.splice(i,1);continue;}
    p.vel.y+=(p.grav||0)*dt;p.pos.addScaledVector(p.vel,dt);
    // clamp to ground: replace 0.2 with your height function if you have one
    if(p.pos.y<0.2)p.pos.y=0.2;
    p.mesh.position.copy(p.pos);
    const k=p.life/p.maxLife;
    if(p.grow){const s=p.baseS*(1+(1-k)*p.grow);p.mesh.scale.set(s,s,s);}
    if(p.mesh.material.opacity!==undefined)p.mesh.material.opacity=k*p.baseO;
  }
  for(const l of flashPool)if(l.active)l.intensity=Math.max(0,l.intensity-90*dt),l.intensity<=0&&(l.active=false);
}
function puff(pos,vel,color,size,grow,life,grav,baseO=0.5){
  const m=new THREE.Sprite(new THREE.SpriteMaterial({map:SOFT_TEX,color,transparent:true,opacity:baseO,depthWrite:false}));
  m.position.copy(pos);m.scale.set(size,size,1);scene.add(m);
  particles.push({mesh:m,pos:pos.clone(),vel,life,maxLife:life,grow,baseS:size,baseO,grav});
}
```
Usage patterns that read "real":
- Muzzle flash: `flashLight(muzzlePos,0.5..2.6,0xffcf8a)` + 3 gray puffs drifting back off the muzzle.
- Impact sparks: 10–14 white/`0xffc873` puffs, size .4–.9, life .12–.3, slight negative grav (they fall), baseO .7–.9 so bloom catches them.
- Smoke column: 4–6 gray puffs size 1.6–2.8, grow 2.2, life 1.2–2.6, grav −0.3 (negative = drifts UP slowly), baseO .55.
- Explosion: fireball core puff `0xff9a4a` size 2–3 grow 1.8 life .35 + flashLight(pos, scale, 0xffd9a8).

## 7. Instancing pattern (props) — fill matrices+colors, then set `.count`
```js
const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3();
const cc=new THREE.Color();
const treeMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true});
function mkInst(geo,N){const im=new THREE.InstancedMesh(geo,treeMat,N);im.castShadow=true;scene.add(im);return im;}
// per instance:
q.setFromEuler(new THREE.Euler(rand(-.04,.04),rand(0,TAU),rand(-.04,.04)));
p.set(x,h-0.1,z);s.set(sc,sc*rand(.9,1.25),sc);m.compose(p,q,s);
im.setMatrixAt(i,m);
cc.setHSL(hue+rand(-.03,.03),sat,lum+rand(-.02,.02));im.setColorAt(i,cc); // per-instance tone variation
// after fill loop:
im.count=actualFilled; // shrink if not all slots used
```

## 8. Performance checklist
- `renderer.setPixelRatio(Math.min(devicePixelRatio,1.6))` — never raw devicePixelRatio.
- One shadow-casting light (sun). Pools ≤6 PointLights. Sprites: cap live puffs ~200 (updateParticles removes dead ones; also splice oldest if over cap).
- Tracers: additive `LineBasicMaterial({transparent:true,opacity:.9})` with 2-point BufferGeometry updated in place, or short-lived stretched Box meshes; fade+remove after ~80–150 ms.
- InstancedMesh for repeated props (parked cars, streetlights bases, trees). Emissive windows/lights instead of per-object lights.
- No `new` inside the frame loop except pooled sprite puffs; reuse scratch objects declared once at module scope.
