struct Velocity {
    x: f32,
    y: f32,
};

struct Ball {
    x: f32,
    y: f32,
    radius: f32,
    velocity: Velocity,
    r: f32,
    g: f32,
    b: f32,
};

struct Viewport {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
};

@group(0) @binding(1) var<storage, read> balls: array<Ball>;
@group(0) @binding(5) var<uniform> viewport: Viewport;



const BASE_COLOR = vec4f(0.0, 0.0, 0.0, 1.0);
// stickyness lower = more sticky
const METABALL_THRESHOLD = 0.8;

@fragment
fn main(@builtin(position) coord: vec4f) -> @location(0) vec4f {
    let viewport_size = vec2f(viewport.width, viewport.height);
    // Single scale for both axes so balls stay round regardless of aspect ratio
    let scale = (viewport.width + viewport.height) / 2.0;

    var sum = 0.0;
    var accumulated_color = vec3f(0.0, 0.0, 0.0);
    var total_influence = 0.0;
    
    for (var i = 0u; i < arrayLength(&balls); i++) {
        let ball_pos = vec2f(balls[i].x, balls[i].y);
        let influence = get_metaball(coord.xy, ball_pos, balls[i].radius, viewport_size, scale);
        sum += influence;
        
        // Accumulate color weighted by influence
        let ball_color = vec3f(balls[i].r, balls[i].g, balls[i].b);
        accumulated_color += ball_color * influence;
        total_influence += influence;
    }

    var color = BASE_COLOR;
    if sum >= METABALL_THRESHOLD {
        let intensity = min(sum / METABALL_THRESHOLD, 2.0);
        // Use weighted average of ball colors
        let final_ball_color = accumulated_color / max(total_influence, 0.0001);
        color = mix(BASE_COLOR, vec4f(final_ball_color, 1.0), intensity * 0.8);
    }

    return color;
}

fn get_metaball(pos: vec2f, ball_pos: vec2f, radius: f32, size: vec2f, scale: f32) -> f32 {
    // this makes it work around wrapped edges, claude smart
    // Calculate wrapped distance (toroidal topology) in pixels
    var d = abs(ball_pos - pos);
    
    if (d.x > size.x / 2.0) {
        d.x = size.x - d.x;
    }
    if (d.y > size.y / 2.0) {
        d.y = size.y - d.y;
    }
    
    // Normalize with the same scale on both axes
    d = d / scale;
    let r = radius / scale;
    let dist_sq = dot(d, d);
    // prevent divide by 0
    return (r * r) / (dist_sq + 0.0001);
}
