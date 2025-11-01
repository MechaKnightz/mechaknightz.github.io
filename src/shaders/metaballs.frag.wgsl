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
const METABALL_THRESHOLD = 1.2;

@fragment
fn main(@builtin(position) coord: vec4f) -> @location(0) vec4f {
    // Normalize pixel coordinates to 0-1 range using viewport dimensions
    let uv = coord.xy / vec2f(viewport.width, viewport.height);

    var sum = 0.0;
    var accumulated_color = vec3f(0.0, 0.0, 0.0);
    var total_influence = 0.0;
    
    for (var i = 0u; i < arrayLength(&balls); i++) {
        // Normalize ball position to 0-1 range (only x and y, no z)
        let ball_pos = vec2f(
            balls[i].x / viewport.width, 
            balls[i].y / viewport.height
        );
        // Normalize radius to 0-1 range based on average dimension
        let normalized_radius = balls[i].radius / ((viewport.width + viewport.height) / 2.0);
        let influence = get_metaball(uv, ball_pos, normalized_radius);
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

fn get_metaball(pos: vec2f, ball_pos: vec2f, radius: f32) -> f32 {
    // this makes it work around wrapped edges, claude smart
    // Calculate wrapped distance (toroidal topology)
    var dx = abs(ball_pos.x - pos.x);
    var dy = abs(ball_pos.y - pos.y);
    
    if (dx > 0.5) {
        dx = 1.0 - dx;
    }
    if (dy > 0.5) {
        dy = 1.0 - dy;
    }
    
    let dist_sq = dx * dx + dy * dy;
    // prevent divide by 0
    return (radius * radius) / (dist_sq + 0.0001);
}