import { useEffect, useRef } from 'react'

// ?raw to make vite import as string
import triangleVertWGSL from "../shaders/triangle.vert.wgsl?raw";
import redFragWGSL from "../shaders/metaballs.frag.wgsl?raw";
import { useResizeObserver } from '../hooks/use-resize-observer';

type Point2D = {
  x: number;
  y: number;
};

type Ball = {
  radius: number;
  velocity: Point2D;
  r: number;
  g: number;
  b: number;
  canMergeAfter?: number; // Timestamp when ball can merge again
} & Point2D;

const initWgpuDeviceAndAdapter = async () => {
  const adapter = await navigator.gpu?.requestAdapter({
    featureLevel: "compatibility",
  });

  if (!adapter) {
    throw new Error("No adapter found");
  }
  const device = await adapter?.requestDevice();

  if (!device) {
    throw new Error("No device found");
  }

  return {
    adapter,
    device,
  }
}

const CAMERA_SPEED = 0.2;
const MIN_VELOCITY = 50; // Minimum velocity in pixels per second

// why does this function not exist in js?
const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(value, max));
};

// Calculate distance in toroidal space (wrapping edges)
const toroidalDistance = (x1: number, y1: number, x2: number, y2: number, width: number, height: number) => {
  let dx = Math.abs(x1 - x2);
  let dy = Math.abs(y1 - y2);

  // If distance is more than half the viewport, use wrapped distance
  if (dx > width / 2) {
    dx = width - dx;
  }
  if (dy > height / 2) {
    dy = height - dy;
  }

  return Math.sqrt(dx * dx + dy * dy);
};

const FLOAT_SIZE = 4;
const ballStride = 8; // x, y, radius, vx, vy, r, g, b

const colorUniformSize = FLOAT_SIZE * 4;
const cameraZUniformSize = FLOAT_SIZE;
const timeUniformSize = FLOAT_SIZE;
const viewportUniformSize = FLOAT_SIZE * 4; // x, y, width, height

const ballsToBufferValues = (balls: Ball[]) => {
  const ballCount = balls.length;
  const ballUniformSize = FLOAT_SIZE * ballStride * ballCount;

  const bufferValues = new Float32Array(ballUniformSize / FLOAT_SIZE);
  balls.forEach((ball, index) => {
    bufferValues[index * ballStride] = ball.x;
    bufferValues[index * ballStride + 1] = ball.y;
    bufferValues[index * ballStride + 2] = ball.radius;
    bufferValues[index * ballStride + 3] = ball.velocity.x;
    bufferValues[index * ballStride + 4] = ball.velocity.y;
    bufferValues[index * ballStride + 5] = ball.r;
    bufferValues[index * ballStride + 6] = ball.g;
    bufferValues[index * ballStride + 7] = ball.b;
  });
  return bufferValues;
};

const SimulationCanvas = () => {

  const adapterRef = useRef<GPUAdapter | null>(null);
  const deviceRef = useRef<GPUDevice | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const upArrowPressedRef = useRef(false);
  const downArrowPressedRef = useRef(false);
  const ballsRef = useRef<Ball[]>([]);
  const bindgroupRef = useRef<GPUBindGroup | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const contextRef = useRef<GPUCanvasContext | null>(null);

  const colorBufferRef = useRef<GPUBuffer | null>(null);
  const ballBufferRef = useRef<GPUBuffer | null>(null);
  const canvasSizeBufferRef = useRef<GPUBuffer | null>(null);
  const timeBufferRef = useRef<GPUBuffer | null>(null);
  const cameraZBufferRef = useRef<GPUBuffer | null>(null);
  const viewportBufferRef = useRef<GPUBuffer | null>(null);

  const colorBufferValuesRef = useRef(new Float32Array(colorUniformSize / 4));
  const canvasSizeBufferValuesRef = useRef(new Float32Array(2));
  const timeBufferValuesRef = useRef(new Float32Array(timeUniformSize / FLOAT_SIZE));
  const cameraZBufferValuesRef = useRef(new Float32Array(cameraZUniformSize / FLOAT_SIZE));
  const viewportBufferValuesRef = useRef(new Float32Array(viewportUniformSize / FLOAT_SIZE));

  let timeRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const spawnBall = (width: number, height: number, existingBalls: Ball[]) => {
    const avgDimension = (width + height) / 2;
    let x: number, y: number, radius: number;
    let attempts = 0;
    const maxAttempts = 50;

    // Try to find a spawn position that doesn't overlap with existing balls
    do {
      x = Math.random() * width;
      y = Math.random() * height;
      radius = (Math.random() * 0.06 + 0.02) * avgDimension;
      attempts++;

      // Check if this position is far enough from all existing balls
      const tooClose = existingBalls.some(ball => {
        const distance = toroidalDistance(x, y, ball.x, ball.y, width, height);
        const minDistance = radius + ball.radius + 20; // Add 20px buffer
        return distance < minDistance;
      });

      if (!tooClose || attempts >= maxAttempts) {
        break;
      }
    } while (attempts < maxAttempts);

    // Generate more vibrant, saturated colors
    // Pick a random hue and make it saturated
    const hue = Math.random();
    let r, g, b;

    if (hue < 0.33) {
      // Red-ish colors
      r = 0.7 + Math.random() * 0.3;
      g = Math.random() * 0.3;
      b = Math.random() * 0.3;
    } else if (hue < 0.66) {
      // Green-ish colors
      r = Math.random() * 0.3;
      g = 0.7 + Math.random() * 0.3;
      b = Math.random() * 0.3;
    } else {
      // Blue-ish colors
      r = Math.random() * 0.3;
      g = Math.random() * 0.3;
      b = 0.7 + Math.random() * 0.3;
    }

    return {
      x,
      y,
      radius,
      velocity: {
        x: (Math.random() * 0.2 - 0.1) * width,
        y: (Math.random() * 0.2 - 0.1) * height,
      },
      r,
      g,
      b,
    };
  };

  const resizeElementRef = useResizeObserver<HTMLCanvasElement>((size) => {
    let devicePixelRatio = window.devicePixelRatio;
    if (canvasRef.current) {
      canvasRef.current.width = size.width * devicePixelRatio;
      canvasRef.current.height = size.height * devicePixelRatio;
    }
    canvasSizeBufferValuesRef.current[0] = size.width * devicePixelRatio;
    canvasSizeBufferValuesRef.current[1] = size.height * devicePixelRatio;
    viewportBufferValuesRef.current[0] = 0;
    viewportBufferValuesRef.current[1] = 0;
    viewportBufferValuesRef.current[2] = size.width * devicePixelRatio;
    viewportBufferValuesRef.current[3] = size.height * devicePixelRatio;
  });

  const loop = () => {
    if (!deviceRef.current || !contextRef.current || !bindgroupRef.current || !pipelineRef.current || !colorBufferRef.current || !ballBufferRef.current || !canvasSizeBufferRef.current || !timeBufferRef.current || !cameraZBufferRef.current || !viewportBufferRef.current) return;

    const newTime = new Date().getTime();
    const deltaTime = (newTime - timeRef.current) / 1000;
    timeRef.current = newTime;

    const colorTime = timeRef.current / 1000;

    const viewportWidth = viewportBufferValuesRef.current[2];
    const viewportHeight = viewportBufferValuesRef.current[3];

    // Update ball positions
    ballsRef.current = ballsRef.current.map((ball) => {
      ball.x += ball.velocity.x * deltaTime;
      ball.y += ball.velocity.y * deltaTime;

      // Wrap around edges instead of bouncing
      if (ball.x < 0) {
        ball.x += viewportWidth;
      } else if (ball.x > viewportWidth) {
        ball.x -= viewportWidth;
      }

      if (ball.y < 0) {
        ball.y += viewportHeight;
      } else if (ball.y > viewportHeight) {
        ball.y -= viewportHeight;
      }

      // Ensure minimum velocity
      const speed = Math.sqrt(ball.velocity.x * ball.velocity.x + ball.velocity.y * ball.velocity.y);
      if (speed < MIN_VELOCITY) {
        // Scale up velocity to minimum speed, maintaining direction
        const scale = MIN_VELOCITY / (speed + 0.0001); // Avoid divide by zero
        ball.velocity.x *= scale;
        ball.velocity.y *= scale;
      }

      return ball;
    });

    // Check for collisions and merge balls using toroidal distance
    // Mark balls for deletion instead of creating a new array
    const toDelete = new Set<number>();

    for (let i = 0; i < ballsRef.current.length; i++) {
      if (toDelete.has(i)) continue;

      for (let j = i + 1; j < ballsRef.current.length; j++) {
        if (toDelete.has(j)) continue;

        const ball1 = ballsRef.current[i];
        const ball2 = ballsRef.current[j];

        // Skip if either ball is on cooldown
        const currentTime = new Date().getTime();
        if ((ball1.canMergeAfter && currentTime < ball1.canMergeAfter) ||
          (ball2.canMergeAfter && currentTime < ball2.canMergeAfter)) {
          continue;
        }

        const distance = toroidalDistance(ball1.x, ball1.y, ball2.x, ball2.y, viewportWidth, viewportHeight);

        // Merge when balls touch or slightly overlap
        // Threshold at 0.9 means they merge when nearly touching
        const mergeThreshold = (ball1.radius + ball2.radius) * 0.9;

        if (distance < mergeThreshold) {
          // Merge ball2 into ball1, modifying ball1 directly
          const mass1 = ball1.radius * ball1.radius;
          const mass2 = ball2.radius * ball2.radius;
          const totalMass = mass1 + mass2;

          // Handle position wrapping when merging across edges
          let x2 = ball2.x;
          let y2 = ball2.y;
          if (Math.abs(ball1.x - ball2.x) > viewportWidth / 2) {
            x2 = ball2.x < viewportWidth / 2 ? ball2.x + viewportWidth : ball2.x - viewportWidth;
          }
          if (Math.abs(ball1.y - ball2.y) > viewportHeight / 2) {
            y2 = ball2.y < viewportHeight / 2 ? ball2.y + viewportHeight : ball2.y - viewportHeight;
          }

          // Position weighted by mass - larger ball pulls the center more
          ball1.x = (ball1.x * mass1 + x2 * mass2) / totalMass;
          ball1.y = (ball1.y * mass1 + y2 * mass2) / totalMass;

          // Wrap combined position back into viewport
          if (ball1.x < 0) ball1.x += viewportWidth;
          if (ball1.x > viewportWidth) ball1.x -= viewportWidth;
          if (ball1.y < 0) ball1.y += viewportHeight;
          if (ball1.y > viewportHeight) ball1.y -= viewportHeight;

          ball1.radius = Math.sqrt(totalMass);

          // Velocity weighted by mass (momentum conservation)
          // Small balls have less influence on large balls
          ball1.velocity.x = (ball1.velocity.x * mass1 + ball2.velocity.x * mass2) / totalMass;
          ball1.velocity.y = (ball1.velocity.y * mass1 + ball2.velocity.y * mass2) / totalMass;

          // Color weighted by mass with slight randomness to maintain variance
          const colorVariance = 0.05;
          ball1.r = Math.max(0, Math.min(1, (ball1.r * mass1 + ball2.r * mass2) / totalMass + (Math.random() - 0.5) * colorVariance));
          ball1.g = Math.max(0, Math.min(1, (ball1.g * mass1 + ball2.g * mass2) / totalMass + (Math.random() - 0.5) * colorVariance));
          ball1.b = Math.max(0, Math.min(1, (ball1.b * mass1 + ball2.b * mass2) / totalMass + (Math.random() - 0.5) * colorVariance));

          // Mark ball2 for deletion
          toDelete.add(j);
        }
      }
    }

    // Remove deleted balls in one pass
    if (toDelete.size > 0) {
      ballsRef.current = ballsRef.current.filter((_, index) => !toDelete.has(index));

      // Recreate ball buffer with new size
      if (ballBufferRef.current) {
        ballBufferRef.current.destroy();
      }

      const ballUniformSize = FLOAT_SIZE * ballStride * ballsRef.current.length;
      ballBufferRef.current = deviceRef.current.createBuffer({
        size: ballUniformSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // Recreate bind group with new buffer
      bindgroupRef.current = deviceRef.current.createBindGroup({
        layout: pipelineRef.current!.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: ballBufferRef.current } },
          { binding: 5, resource: { buffer: viewportBufferRef.current! } },
        ],
      });
    }

    if (upArrowPressedRef.current) {
      cameraZBufferValuesRef.current[0] += CAMERA_SPEED * deltaTime;
    }
    if (downArrowPressedRef.current) {
      cameraZBufferValuesRef.current[0] -= CAMERA_SPEED * deltaTime;
    }
    cameraZBufferValuesRef.current[0] = clamp(cameraZBufferValuesRef.current[0], 0, 1);

    colorBufferValuesRef.current[0] = Math.sin(colorTime);
    colorBufferValuesRef.current[1] = Math.cos(colorTime);
    colorBufferValuesRef.current[2] = Math.tan(colorTime);
    colorBufferValuesRef.current[3] = Math.atan(colorTime);
    timeBufferValuesRef.current[0] = deltaTime;

    const commandEncoder = deviceRef.current.createCommandEncoder();
    const textureView = contextRef.current.getCurrentTexture().createView();

    const ballBufferValues = ballsToBufferValues(ballsRef.current);

    deviceRef.current.queue.writeBuffer(colorBufferRef.current, 0, colorBufferValuesRef.current);
    deviceRef.current.queue.writeBuffer(ballBufferRef.current, 0, ballBufferValues);
    deviceRef.current.queue.writeBuffer(canvasSizeBufferRef.current, 0, canvasSizeBufferValuesRef.current);
    deviceRef.current.queue.writeBuffer(timeBufferRef.current, 0, timeBufferValuesRef.current);
    deviceRef.current.queue.writeBuffer(cameraZBufferRef.current, 0, cameraZBufferValuesRef.current);
    deviceRef.current.queue.writeBuffer(viewportBufferRef.current, 0, viewportBufferValuesRef.current);

    const renderPassDescriptor: GPURenderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: [0, 0, 0, 0], // Clear to transparent
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    };

    const pass = commandEncoder.beginRenderPass(renderPassDescriptor);
    pass.setPipeline(pipelineRef.current);
    pass.setBindGroup(0, bindgroupRef.current);
    pass.draw(6);
    pass.end();

    deviceRef.current.queue.submit([commandEncoder.finish()]);

    rafIdRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    const setupWebGpu = async () => {
      const { adapter, device } = await initWgpuDeviceAndAdapter();
      adapterRef.current = adapter;
      deviceRef.current = device;
      // setup canvas and device

      const canvas = document.querySelector("canvas") as HTMLCanvasElement;
      // for some reason events get eaten on the canvas
      const body = document.querySelector("body") as HTMLBodyElement;



      contextRef.current = canvas.getContext("webgpu") as GPUCanvasContext;

      const devicePixelRatio = window.devicePixelRatio;
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      const presentationFormat = navigator.gpu.getPreferredCanvasFormat();

      contextRef.current.configure({
        device,
        format: presentationFormat,
      });

      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: device.createShaderModule({
            code: triangleVertWGSL,
          }),
        },
        fragment: {
          module: device.createShaderModule({
            code: redFragWGSL,
          }),
          targets: [
            {
              format: presentationFormat,
            },
          ],
        },
        primitive: {
          topology: "triangle-list",
        },
      });

      pipelineRef.current = pipeline;

      // setup uniforms
      // color uniform
      colorBufferRef.current = device.createBuffer({
        size: colorUniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      const generateBalls = (count: number) => {
        const balls: Ball[] = [];
        const width = canvas.width;
        const height = canvas.height;
        for (let i = 0; i < count; i++) {
          balls.push(spawnBall(width, height, balls));
        }
        return balls;
      };

      ballsRef.current = generateBalls(10);

      const ballUniformSize = FLOAT_SIZE * ballStride * ballsRef.current.length;

      ballBufferRef.current = device.createBuffer({
        size: ballUniformSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      // canvas size uniform
      const canvasSizeUniformSize = FLOAT_SIZE * 2;
      canvasSizeBufferRef.current = device.createBuffer({
        size: canvasSizeUniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      canvasSizeBufferValuesRef.current[0] = canvas.width;
      canvasSizeBufferValuesRef.current[1] = canvas.height;

      // time uniform
      timeBufferRef.current = device.createBuffer({
        size: timeUniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // camera z uniform
      cameraZBufferRef.current = device.createBuffer({
        size: cameraZUniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // viewport uniform
      viewportBufferRef.current = device.createBuffer({
        size: viewportUniformSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      viewportBufferValuesRef.current[0] = 0;
      viewportBufferValuesRef.current[1] = 0;
      viewportBufferValuesRef.current[2] = canvas.width;
      viewportBufferValuesRef.current[3] = canvas.height;

      // bind all uniforms
      bindgroupRef.current = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 1, resource: { buffer: ballBufferRef.current } },
          { binding: 5, resource: { buffer: viewportBufferRef.current } },
        ],
      });

      // setup event listeners

      body.addEventListener("keydown", (event) => {
        if (event.key === "ArrowUp") {
          console.log("up arrow pressed");
          upArrowPressedRef.current = true;
        }
        if (event.key === "ArrowDown") {
          downArrowPressedRef.current = true;
        }
      });

      body.addEventListener("keyup", (event) => {
        if (event.key === "ArrowUp") {
          console.log("up arrow released");
          upArrowPressedRef.current = false;
        }
        if (event.key === "ArrowDown") {
          downArrowPressedRef.current = false;
        }
      });

      // Add click handler to explode balls
      canvas.addEventListener("click", (event) => {
        if (!deviceRef.current) return;
        const rect = canvas.getBoundingClientRect();
        const devicePixelRatio = window.devicePixelRatio;

        // Convert click position to viewport coordinates
        const clickX = (event.clientX - rect.left) * devicePixelRatio;
        const clickY = (event.clientY - rect.top) * devicePixelRatio;

        const viewportWidth = viewportBufferValuesRef.current[2];
        const viewportHeight = viewportBufferValuesRef.current[3];

        // Find the ball that was clicked
        for (let i = 0; i < ballsRef.current.length; i++) {
          const ball = ballsRef.current[i];
          const distance = toroidalDistance(clickX, clickY, ball.x, ball.y, viewportWidth, viewportHeight);

          // Check if click is inside the ball
          if (distance < ball.radius) {
            // Explode this ball into fragments
            const numFragments = Math.floor(Math.random() * 3) + 3; // 3-5 fragments
            const fragments: Ball[] = [];
            const currentTime = new Date().getTime();
            const mergeCooldown = 1000; // 1 second cooldown before fragments can merge

            // Each fragment gets a portion of the original mass
            const fragmentMass = (ball.radius * ball.radius) / numFragments;
            const fragmentRadius = Math.sqrt(fragmentMass);

            for (let j = 0; j < numFragments; j++) {
              // Fully random angles for more varied spread
              const angle = Math.random() * Math.PI * 2;

              // Start fragments at the center
              let fragX = ball.x;
              let fragY = ball.y;

              // Wrap positions
              if (fragX < 0) fragX += viewportWidth;
              if (fragX > viewportWidth) fragX -= viewportWidth;
              if (fragY < 0) fragY += viewportHeight;
              if (fragY > viewportHeight) fragY -= viewportHeight;

              // Each fragment gets velocity shooting outward plus the original ball's velocity
              const explosionSpeed = 300 + Math.random() * 400; // More speed variation

              fragments.push({
                x: fragX,
                y: fragY,
                radius: fragmentRadius,
                velocity: {
                  x: ball.velocity.x + Math.cos(angle) * explosionSpeed,
                  y: ball.velocity.y + Math.sin(angle) * explosionSpeed,
                },
                r: Math.max(0, Math.min(1, ball.r + (Math.random() - 0.5) * 0.5)),
                g: Math.max(0, Math.min(1, ball.g + (Math.random() - 0.5) * 0.5)),
                b: Math.max(0, Math.min(1, ball.b + (Math.random() - 0.5) * 0.5)),
                canMergeAfter: currentTime + mergeCooldown,
              });
            }

            // Replace the clicked ball with fragments
            ballsRef.current.splice(i, 1, ...fragments);

            // Recreate ball buffer with new size
            if (ballBufferRef.current) {
              ballBufferRef.current.destroy();
            }

            const ballUniformSize = FLOAT_SIZE * ballStride * ballsRef.current.length;
            ballBufferRef.current = deviceRef.current.createBuffer({
              size: ballUniformSize,
              usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            // Recreate bind group with new buffer
            bindgroupRef.current = deviceRef.current.createBindGroup({
              layout: pipelineRef.current!.getBindGroupLayout(0),
              entries: [
                { binding: 1, resource: { buffer: ballBufferRef.current } },
                { binding: 5, resource: { buffer: viewportBufferRef.current! } },
              ],
            });

            break; // Only explode one ball per click
          }
        }
      });

      timeRef.current = new Date().getTime();
      loop();
    }
    setupWebGpu();
  }, [])

  return (
    <>
      <canvas id="canvas" ref={(el) => {
        canvasRef.current = el;
        resizeElementRef.current = el;
      }} style={{ width: "100%", height: "100%" }}></canvas>
      <div id="info"></div>
    </>
  )
}

export { SimulationCanvas }