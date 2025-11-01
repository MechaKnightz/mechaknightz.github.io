struct Velocity {
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
}