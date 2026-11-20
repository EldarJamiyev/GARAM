import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { AssetManager } from './AssetManager.js';

export class SceneManager {
  public worldScene: THREE.Scene;
  public worldCamera: THREE.PerspectiveCamera;
  public viewmodelScene: THREE.Scene;
  public viewmodelCamera: THREE.PerspectiveCamera;
  public sunLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;
  public skyMesh: THREE.Mesh;
  public horizonMesh: THREE.InstancedMesh;
  public envMap: THREE.Texture;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private renderer: THREE.WebGLRenderer;
  public isSoftwareGl = false;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    // Detect software WebGL (SwiftShader / llvmpipe) to prevent shadow-pass stalls
    const gl = renderer.getContext();
    const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbgInfo
      ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL) || '')
      : String(gl.getParameter(gl.RENDERER) || '');
    this.isSoftwareGl = /swiftshader|llvmpipe|software|mesa/i.test(rendererStr);

    if (this.isSoftwareGl) {
      renderer.setPixelRatio(1);
      renderer.shadowMap.enabled = false;
    }

    AssetManager.getInstance().setMaxAnisotropy(
      this.isSoftwareGl ? 4 : renderer.capabilities.getMaxAnisotropy()
    );

    // 1. World Scene & Camera with subtle sunlit-horizon atmospheric perspective
    this.worldScene = new THREE.Scene();
    this.worldScene.fog = new THREE.FogExp2(0xc4d8ec, 0.0036);
    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 600);

    // 2. Viewmodel Scene & Camera (Dual-pass at 68 deg FOV, near 0.005m)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.005, 10);

    // 3. PMREM Image-Based Lighting (IBL)
    this.envRenderTarget = this.generateProceduralPMREM(renderer);
    this.envMap = this.envRenderTarget.texture;
    this.worldScene.environment = this.envMap;
    this.viewmodelScene.environment = this.envMap;
    if (!this.isSoftwareGl) {
      this.loadHdrEnvironment(renderer);
    }

    // 4. Calibrated Sun, Cool Fill & Ambient Lighting (High-contrast CS2 visibility)
    this.hemiLight = new THREE.HemisphereLight(0xd4e7ff, 0x4b4842, 0.92);
    this.worldScene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1dc, 1.55);
    this.sunLight.position.set(55, 80, 40);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 220;
    this.sunLight.shadow.bias = -0.00015;
    this.sunLight.shadow.normalBias = 0.025;

    const d = 68;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.worldScene.add(this.sunLight);

    // Opposite cool sky bounce fill so shadowed sides of CS2 operators retain crisp detail
    const fillLight = new THREE.DirectionalLight(0x9ac4ee, 0.5);
    fillLight.position.set(-48, 36, -42);
    this.worldScene.add(fillLight);

    // Viewmodel crisp 3-point studio lighting rig (Warm Key + Cool Rim + Hemisphere Fill)
    const vmHemi = new THREE.HemisphereLight(0xe4f0ff, 0x454a52, 1.15);
    this.viewmodelScene.add(vmHemi);

    const vmKey = new THREE.DirectionalLight(0xfff5e4, 1.65);
    vmKey.position.set(2.5, 4.5, 3.0);
    this.viewmodelScene.add(vmKey);

    const vmRim = new THREE.DirectionalLight(0x88c8ff, 1.05);
    vmRim.position.set(-3.2, 2.2, -2.5);
    this.viewmodelScene.add(vmRim);

    // 5. Atmospheric Gradient Sky Dome with Sun Disc
    this.skyMesh = this.buildAtmosphericSky();
    this.worldScene.add(this.skyMesh);

    // 6. Distant Low-Poly Industrial Horizon Silhouette (Single InstancedMesh = 1 draw call)
    this.horizonMesh = this.buildDistantHorizon();
    this.worldScene.add(this.horizonMesh);
  }

  private generateProceduralPMREM(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const pmremGen = new THREE.PMREMGenerator(renderer);
    pmremGen.compileEquirectangularShader();

    const envScene = new THREE.Scene();

    const geo = new THREE.SphereGeometry(100, 32, 16);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#1a5796');
    grad.addColorStop(0.55, '#89b6db');
    grad.addColorStop(0.78, '#eaf2fa');
    grad.addColorStop(0.82, '#6b665c');
    grad.addColorStop(1.0, '#302d29');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(360, 60, 28, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.mapping = THREE.EquirectangularReflectionMapping;

    const envMat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    const envMesh = new THREE.Mesh(geo, envMat);
    envScene.add(envMesh);

    const envTarget = pmremGen.fromScene(envScene);

    envScene.remove(envMesh);
    geo.dispose();
    envMat.dispose();
    tex.dispose();
    pmremGen.dispose();

    return envTarget;
  }

  private loadHdrEnvironment(renderer: THREE.WebGLRenderer): void {
    new RGBELoader().load(
      '/textures/skybox/kloofendal_1k.hdr',
      (texture) => {
        const pmremGen = new THREE.PMREMGenerator(renderer);
        pmremGen.compileEquirectangularShader();
        const envTarget = pmremGen.fromEquirectangular(texture);
        texture.dispose();
        pmremGen.dispose();

        if (this.envRenderTarget) {
          this.envRenderTarget.dispose();
        } else if (this.envMap) {
          this.envMap.dispose();
        }
        this.envRenderTarget = envTarget;
        this.envMap = envTarget.texture;
        this.worldScene.environment = this.envMap;
        this.viewmodelScene.environment = this.envMap;
      },
      undefined,
      () => {
        // Fallback procedural PMREM already active
      }
    );
  }

  private buildAtmosphericSky(): THREE.Mesh {
    const skyGeo = new THREE.SphereGeometry(450, 32, 24);

    const vShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fShader = `
      uniform vec3 sunPosition;
      varying vec3 vWorldPosition;

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float y = dir.y;

        vec3 zenithColor = vec3(0.09, 0.34, 0.62);
        vec3 horizonColor = vec3(0.85, 0.91, 0.98);
        vec3 groundColor = vec3(0.24, 0.22, 0.20);

        vec3 sky = mix(horizonColor, zenithColor, clamp(pow(max(y, 0.0), 0.65), 0.0, 1.0));
        if (y < 0.0) {
          sky = mix(horizonColor, groundColor, clamp(-y * 6.0, 0.0, 1.0));
        }

        vec3 sunDir = normalize(sunPosition);
        float cosTheta = dot(dir, sunDir);
        float sunDisc = smoothstep(0.9982, 0.9996, cosTheta);
        float sunGlow = pow(max(cosTheta, 0.0), 16.0) * 0.45;

        vec3 finalColor = sky + vec3(1.0, 0.95, 0.8) * (sunDisc * 3.5 + sunGlow);
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `;

    const skyMat = new THREE.ShaderMaterial({
      vertexShader: vShader,
      fragmentShader: fShader,
      uniforms: {
        sunPosition: { value: this.sunLight.position },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });

    return new THREE.Mesh(skyGeo, skyMat);
  }

  /**
   * Distant low-poly industrial silhouette batched into 1 single InstancedMesh (1 draw call instead of 48)
   */
  private buildDistantHorizon(): THREE.InstancedMesh {
    const numStructures = 48;
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x485868,
      fog: false,
    });

    const instanced = new THREE.InstancedMesh(unitBox, horizonMat, numStructures);
    instanced.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const radius = 175;

    for (let i = 0; i < numStructures; i++) {
      // Deterministic pseudo-random silhouette layout
      const seed = Math.sin(i * 12.9898) * 43758.5453;
      const r1 = seed - Math.floor(seed);
      const seed2 = Math.sin(i * 78.233) * 19341.1234;
      const r2 = seed2 - Math.floor(seed2);

      const angle = (i / numStructures) * Math.PI * 2;
      const dist = radius + (r1 - 0.5) * 30;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      let sx: number;
      let sy: number;
      let sz: number;

      if (r1 < 0.45) {
        sx = 18 + r2 * 24;
        sy = 14 + r1 * 32;
        sz = 16 + r2 * 18;
      } else if (r1 < 0.75) {
        sx = 6 + r2 * 5;
        sy = 35 + r2 * 45;
        sz = 6 + r2 * 5;
      } else {
        sx = 4;
        sy = 45 + r2 * 35;
        sz = 4;
      }

      dummy.position.set(x, sy * 0.5 - 4, z);
      dummy.rotation.set(0, r2 * Math.PI, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
  }

  public update(_dt: number, cameraPos: THREE.Vector3): void {
    this.skyMesh.position.copy(cameraPos);
    this.horizonMesh.position.set(cameraPos.x, 0, cameraPos.z);
  }

  public scheduleNextFrame(cb: (now: number) => void): void {
    if (!this.isSoftwareGl) {
      requestAnimationFrame(cb);
      return;
    }
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          window.setTimeout(poll, 8);
        } else {
          if (sync) gl.deleteSync(sync);
          window.setTimeout(() => cb(performance.now()), 80);
        }
      };
      window.setTimeout(poll, 8);
    } else {
      window.setTimeout(() => cb(performance.now()), 80);
    }
  }

  public dispose(): void {
    if (this.envRenderTarget) {
      this.envRenderTarget.dispose();
      this.envRenderTarget = null;
    } else if (this.envMap) {
      this.envMap.dispose();
    }
    this.worldScene.environment = null;
    this.viewmodelScene.environment = null;

    this.skyMesh.geometry.dispose();
    (this.skyMesh.material as THREE.Material).dispose();
    this.horizonMesh.geometry.dispose();
    (this.horizonMesh.material as THREE.Material).dispose();
  }
}
