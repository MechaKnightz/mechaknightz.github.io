(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))i(o);new MutationObserver(o=>{for(const s of o)if(s.type==="childList")for(const d of s.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&i(d)}).observe(document,{childList:!0,subtree:!0});function r(o){const s={};return o.integrity&&(s.integrity=o.integrity),o.referrerPolicy&&(s.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?s.credentials="include":o.crossOrigin==="anonymous"?s.credentials="omit":s.credentials="same-origin",s}function i(o){if(o.ep)return;o.ep=!0;const s=r(o);fetch(o.href,s)}})();const D=`@vertex
fn main(
    @builtin(vertex_index) VertexIndex: u32
) -> @builtin(position) vec4f {
    var pos = array<vec2f, 6>(
        vec2(-1, 1),
        vec2(-1, -1),
        vec2(1, -1),
        vec2(1, 1),
        vec2(1, -1),
        vec2(-1, 1),
    );

    return vec4f(pos[VertexIndex], 0.0, 1.0);
}
`,V=`struct Velocity {
    x: f32,
    y: f32,
    z: f32,
};

struct Colors {
    r: f32,
    g: f32,
    b: f32,
    a: f32,
};

struct Ball {
    x: f32,
    y: f32,
    z: f32,
    radius: f32,
    velocity: Velocity,
};

struct CanvasSize {
    width: f32,
    height: f32,
};

@group(0) @binding(0) var<uniform> colors: Colors;
@group(0) @binding(1) var<storage, read> balls: array<Ball>;
@group(0) @binding(2) var<uniform> canvas_size: CanvasSize;
@group(0) @binding(3) var<uniform> delta_time: f32;
@group(0) @binding(4) var<uniform> camera_z: f32;



const BASE_COLOR = vec4f(0.0, 0.0, 0.0, 1.0);
const METABALL_THRESHOLD = 8.0;
// change this to same as METABALL_THRESHOLD if you want to see the edges more
// higher values = closer edge
const METABALL_CUTOFF = 0.1; 
const METABALL_SCALE = 0.2;
const INTENSITY_SCALE = 0.8;

@fragment
fn main(@builtin(position) coord: vec4f) -> @location(0) vec4f {
    let test = colors.r;
    let camera_z = camera_z;

    let canvas_size = vec2f(canvas_size.width, canvas_size.height);
    let uv = (coord.xy / canvas_size);

    var sum = 0.0;
    for (var i = 0u; i < arrayLength(&balls); i++) {
        let ball_pos = vec3f(balls[i].x, balls[i].y, balls[i].z);
        let influence = get_metaball(uv, ball_pos, balls[i].radius, camera_z);
        sum += influence;
    }

    // let ball_color = vec4f(colors.r, colors.g, colors.b, colors.a);
    let ball_color = vec4(uv, 0.25 + 0.5 * sin(delta_time), 1.0);

    var color = BASE_COLOR;
    if sum >= METABALL_CUTOFF {
        let intensity = min(sum / METABALL_THRESHOLD, 3.0);
        color = mix(BASE_COLOR, ball_color, intensity * INTENSITY_SCALE);
    }

    return color;
}

fn get_metaball(pos: vec2f, ball_pos: vec3f, radius: f32, camera_z: f32) -> f32 {
    let dist_sq = pow(ball_pos.x - pos.x, 2.0) + pow(ball_pos.y - pos.y, 2.0) + pow(camera_z - ball_pos.z, 2.0);
    // prevent divide by 0
    return ((radius * radius) * METABALL_SCALE) / (dist_sq + 0.0001);
}`,c=4,u=document.querySelector("canvas"),N=document.querySelector("#info"),A=document.querySelector("body"),z=await navigator.gpu?.requestAdapter({featureLevel:"compatibility"});if(!z)throw new Error("No adapter found");const t=await z?.requestDevice();if(!t)throw new Error("No device found");const S=u.getContext("webgpu"),L=window.devicePixelRatio;u.width=u.clientWidth*L;u.height=u.clientHeight*L;const b=navigator.gpu.getPreferredCanvasFormat();S.configure({device:t,format:b});const E=t.createRenderPipeline({layout:"auto",vertex:{module:t.createShaderModule({code:D})},fragment:{module:t.createShaderModule({code:V}),targets:[{format:b}]},primitive:{topology:"triangle-list"}}),U=c*4,O=t.createBuffer({size:U,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),m=new Float32Array(U/4),I=a=>{const e=[];for(let r=0;r<a;r++)e.push({x:Math.random(),y:Math.random(),z:Math.random(),radius:Math.random()*.05+.1,velocity:{x:Math.random()*.2-.1,y:Math.random()*.2-.1,z:Math.random()*.2-.1}});return e},y=I(1e3),H=y.length,f=7,T=c*f*H,Y=a=>{const e=new Float32Array(T/c);return a.forEach((r,i)=>{e[i*f]=r.x,e[i*f+1]=r.y,e[i*f+2]=r.z,e[i*f+3]=r.radius,e[i*f+4]=r.velocity.x,e[i*f+5]=r.velocity.y,e[i*f+6]=r.velocity.z}),e},P=t.createBuffer({size:T,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),M=c*2,x=t.createBuffer({size:M,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),p=new Float32Array(M/c);p[0]=u.width;p[1]=u.height;const C=c,F=t.createBuffer({size:C,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),B=new Float32Array(C/c),G=c,q=t.createBuffer({size:G,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),l=new Float32Array(G/c),Z=t.createBindGroup({layout:E.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:O}},{binding:1,resource:{buffer:P}},{binding:2,resource:{buffer:x}},{binding:3,resource:{buffer:F}},{binding:4,resource:{buffer:q}}]});let h=!1,w=!1;A.addEventListener("keydown",a=>{a.key==="ArrowUp"&&(console.log("up arrow pressed"),h=!0),a.key==="ArrowDown"&&(w=!0)});A.addEventListener("keyup",a=>{a.key==="ArrowUp"&&(console.log("up arrow released"),h=!1),a.key==="ArrowDown"&&(w=!1)});const _=.2,W=(a,e,r)=>Math.max(e,Math.min(a,r));let v=new Date().getTime();function R(){const a=new Date().getTime(),e=(a-v)/1e3;v=a;const r=v/1e3;y.forEach(n=>{n.x+=n.velocity.x*e,n.y+=n.velocity.y*e,n.z+=n.velocity.z*e,(n.x<0||n.x>1)&&(n.velocity.x=-n.velocity.x),(n.y<0||n.y>1)&&(n.velocity.y=-n.velocity.y),(n.z<0||n.z>1)&&(n.velocity.z=-n.velocity.z)}),h&&(l[0]+=_*e),w&&(l[0]-=_*e),l[0]=W(l[0],0,1),N.textContent=`Camera Z: ${l[0]}`,m[0]=Math.sin(r),m[1]=Math.cos(r),m[2]=Math.tan(r),m[3]=Math.atan(r),B[0]=e;const i=t.createCommandEncoder(),o=S.getCurrentTexture().createView(),s=Y(y);t.queue.writeBuffer(O,0,m),t.queue.writeBuffer(P,0,s),t.queue.writeBuffer(x,0,p),t.queue.writeBuffer(F,0,B),t.queue.writeBuffer(q,0,l);const d={colorAttachments:[{view:o,clearValue:[0,0,0,0],loadOp:"clear",storeOp:"store"}]},g=i.beginRenderPass(d);g.setPipeline(E),g.setBindGroup(0,Z),g.draw(6),g.end(),t.queue.submit([i.finish()]),requestAnimationFrame(R)}requestAnimationFrame(R);
