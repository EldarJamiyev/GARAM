import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { AssetManager } from './AssetManager.js';
import { PostProcessPipeline } from './PostProcessPipeline.js';
import { ViewmodelLighting } from './ViewmodelLighting.js';

import { QualityTier } from '../core/SettingsStore.js';

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
  public postProcess: PostProcessPipeline;
  public viewmodelLighting: ViewmodelLighting;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private renderer: THREE.WebGLRenderer;
  public isSoftwareGl = false;
  public activeQualityTier: QualityTier = 'HIGH';
  public currentDpr = 1;

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

    // 1. World Scene & Camera with crisp CS_OFFICE winter daylight atmospheric perspective
    this.worldScene = new THREE.Scene();
    this.worldScene.fog = new THREE.FogExp2(0xd6e1ec, 0.0032);
    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 600);

    // 2. Viewmodel Scene & Camera (Dual-pass at CS2 Pro 62 deg FOV, Hor+ widened on narrow viewports)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.005, 10);
    this.updateViewmodelProjection(window.innerWidth, window.innerHeight);

    // 3. PMREM Image-Based Lighting (IBL)
    this.envRenderTarget = this.generateProceduralPMREM(renderer);
    this.envMap = this.envRenderTarget.texture;
    this.worldScene.environment = this.envMap;
    this.viewmodelScene.environment = this.envMap;
    if (!this.isSoftwareGl) {
      this.loadHdrEnvironment(renderer);
    }

    // 4. Crisp CS_OFFICE Winter Sun + Bright Sky Bounce GI
    this.hemiLight = new THREE.HemisphereLight(0xc2d8f0, 0x707882, 0.92);
    this.worldScene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6ea, 1.95);
    this.sunLight.position.set(42, 58, -38);
    this.sunLight.target.position.set(0, 1.4, 0);
    this.worldScene.add(this.sunLight.target);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 210;
    this.sunLight.shadow.bias = -0.00035;
    this.sunLight.shadow.normalBias = 0.035;

    const d = 56;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.worldScene.add(this.sunLight);

    // Subtle cool sky bounce fill on shadowed faces so operator silhouettes pop cleanly
    const fillLight = new THREE.DirectionalLight(0x9cc4f0, 0.35);
    fillLight.position.set(-42, 24, -38);
    this.worldScene.add(fillLight);

    // Viewmodel crisp 3-point studio lighting rig (Warm Sun Key + Cool Sky Rim + Balanced Hemisphere)
    const vmHemi = new THREE.HemisphereLight(0xdbe8f8, 0x4a4035, 0.65);
    this.viewmodelScene.add(vmHemi);

    const vmKey = new THREE.DirectionalLight(0xfff4e0, 2.1);
    vmKey.position.set(3.0, 5.0, 4.0);
    this.viewmodelScene.add(vmKey);

    const vmRim = new THREE.DirectionalLight(0x8ebeff, 0.75);
    vmRim.position.set(-4.0, 2.0, -2.0);
    this.viewmodelScene.add(vmRim);

    // 5. Atmospheric Rayleigh/Mie Sky Dome with soft bloomed solar aureole
    this.skyMesh = this.buildAtmosphericSky();
    this.worldScene.add(this.skyMesh);

    // 6. Distant Sunlit Mediterranean Skyline + Industrial Foundry Cranes (1 draw call)
    this.horizonMesh = this.buildDistantHorizon();
    this.worldScene.add(this.horizonMesh);

    // 7. CS2 Post-Processing Optical Pipeline (GTAO crevice contact shadows + filmic bloom)
    this.postProcess = new PostProcessPipeline(renderer, this.worldScene, this.worldCamera, this.isSoftwareGl);

    // 8. Dynamic Viewmodel Zone Lighting Controller
    this.viewmodelLighting = new ViewmodelLighting(this.viewmodelScene);
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
    grad.addColorStop(0.0, '#103c75');
    grad.addColorStop(0.46, '#5c9ad0');
    grad.addColorStop(0.74, '#eadac4');
    grad.addColorStop(0.82, '#7d6952');
    grad.addColorStop(1.0, '#362c22');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Soft radial sun bloom for metallic viewmodel specular reflections
    const sunGrad = ctx.createRadialGradient(356, 68, 4, 356, 68, 56);
    sunGrad.addColorStop(0.0, 'rgba(255, 250, 238, 1.0)');
    sunGrad.addColorStop(0.32, 'rgba(255, 224, 175, 0.72)');
    sunGrad.addColorStop(1.0, 'rgba(255, 210, 150, 0.0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(290, 10, 130, 120);

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

        // Rayleigh vertical sky gradient (deep cerulean zenith -> sunlit Mediterranean horizon)
        vec3 zenithColor = vec3(0.11, 0.32, 0.62);
        vec3 midSkyColor = vec3(0.32, 0.56, 0.80);
        vec3 horizonColor = vec3(0.86, 0.80, 0.71);
        vec3 groundColor = vec3(0.34, 0.29, 0.23);

        vec3 sky = mix(horizonColor, midSkyColor, smoothstep(0.0, 0.26, max(y, 0.0)));
        sky = mix(sky, zenithColor, smoothstep(0.20, 0.86, max(y, 0.0)));
        if (y < 0.0) {
          sky = mix(horizonColor, groundColor, clamp(-y * 6.0, 0.0, 1.0));
        }

        // Subtle procedural wispy Mediterranean cirrus clouds
        float cloudUV = atan(dir.z, dir.x) * 3.0;
        float cloudBand = smoothstep(0.08, 0.34, y) * (1.0 - smoothstep(0.45, 0.78, y));
        float wisp = sin(cloudUV * 2.1 + y * 9.0) * cos(cloudUV * 3.7 - y * 6.0) * 0.5 + 0.5;
        sky = mix(sky, vec3(0.95, 0.91, 0.85), cloudBand * smoothstep(0.62, 0.94, wisp) * 0.16);

        // Realistic tight solar disc + crisp Mie corona (eliminating blown-out white sun blob)
        vec3 sunDir = normalize(sunPosition);
        float sunDot = max(dot(dir, sunDir), 0.0);
        float solarDisc = smoothstep(0.9990, 0.9997, sunDot) * 1.8;
        float mieCore = pow(sunDot, 180.0) * 0.45;
        float mieAureole = pow(sunDot, 42.0) * 0.14;
        float mieGlow = pow(sunDot, 14.0) * 0.06;
        float warmHorizon = pow(1.0 - clamp(abs(y), 0.0, 1.0), 5.0) * 0.16;

        vec3 finalColor = sky
          + vec3(1.0, 0.98, 0.90) * solarDisc
          + vec3(1.0, 0.92, 0.78) * mieCore
          + vec3(1.0, 0.84, 0.62) * (mieAureole + mieGlow)
          + vec3(0.94, 0.82, 0.68) * warmHorizon;
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
   * Distant sunlit Mediterranean city skyline + industrial foundry cranes on +X side (1 draw call)
   */
  private buildDistantHorizon(): THREE.InstancedMesh {
    const numBaseStructures = 56;
    const craneParts = 12; // 4 distant steel cranes (mast + jib + counter-jib) behind B Foundry (+X)
    const totalInstances = numBaseStructures * 2 + craneParts;
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const horizonMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.04,
      fog: true,
    });

    const instanced = new THREE.InstancedMesh(unitBox, horizonMat, totalInstances);
    instanced.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const warmPalette = [0xc2b097, 0xb8a58b, 0xcab89d, 0xa8967e, 0xbc9f84];
    const industrialPalette = [0x6e7b88, 0x5c6976, 0x7a8590, 0x64707d];
    const radius = 195;

    for (let i = 0; i < numBaseStructures; i++) {
      const seed = Math.sin(i * 12.9898) * 43758.5453;
      const r1 = seed - Math.floor(seed);
      const seed2 = Math.sin(i * 78.233) * 19341.1234;
      const r2 = seed2 - Math.floor(seed2);

      const angle = (i / numBaseStructures) * Math.PI * 2;
      const dist = radius + (r1 - 0.5) * 38;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;
      const isFoundrySide = x > 55;

      let sx: number;
      let sy: number;
      let sz: number;

      if (r1 < 0.52) {
        sx = 20 + r2 * 24;
        sy = 12 + r1 * 18;
        sz = 18 + r2 * 18;
      } else if (r1 < 0.82) {
        sx = 13 + r2 * 14;
        sy = 20 + r2 * 16;
        sz = 13 + r2 * 12;
      } else {
        // Tall Mediterranean bell tower / spire / industrial silo
        sx = 7 + r2 * 5;
        sy = 30 + r2 * 16;
        sz = 7 + r2 * 5;
      }

      dummy.position.set(x, sy * 0.5 - 4, z);
      dummy.rotation.set(0, r2 * Math.PI, 0);
      dummy.scale.set(sx, sy, sz);
      dummy.updateMatrix();
      instanced.setMatrixAt(i * 2, dummy.matrix);
      const pal = isFoundrySide ? industrialPalette : warmPalette;
      tint.setHex(pal[i % pal.length]);
      instanced.setColorAt(i * 2, tint);

      // Terraced rooftop parapet / pitched bell-tower crown
      const upperSx = sx * (0.44 + r1 * 0.24);
      const upperSy = 5 + r2 * 11;
      const upperSz = sz * (0.44 + r2 * 0.24);
      dummy.position.set(x, sy - 4 + upperSy * 0.5, z);
      dummy.scale.set(upperSx, upperSy, upperSz);
      dummy.updateMatrix();
      instanced.setMatrixAt(i * 2 + 1, dummy.matrix);
      tint.setHex(isFoundrySide ? industrialPalette[(i + 1) % industrialPalette.length] : 0xb38466);
      instanced.setColorAt(i * 2 + 1, tint);
    }

    // 4 Distant Industrial Foundry Tower Cranes on East (+X) Skyline
    let idx = numBaseStructures * 2;
    const craneSpecs = [
      { x: 148, z: -48, h: 46, yaw: 0.45 },
      { x: 162, z: -12, h: 52, yaw: -0.32 },
      { x: 155, z: 26, h: 42, yaw: 0.85 },
      { x: 138, z: -78, h: 38, yaw: -0.65 },
    ];
    for (const c of craneSpecs) {
      // Mast
      dummy.position.set(c.x, c.h * 0.5 - 4, c.z);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.scale.set(2.4, c.h, 2.4);
      dummy.updateMatrix();
      instanced.setMatrixAt(idx, dummy.matrix);
      tint.setHex(0x8a5b3e);
      instanced.setColorAt(idx++, tint);

      // Horizontal Jib
      dummy.position.set(c.x + Math.cos(c.yaw) * 10, c.h - 4.5, c.z - Math.sin(c.yaw) * 10);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.scale.set(34, 2.0, 2.0);
      dummy.updateMatrix();
      instanced.setMatrixAt(idx, dummy.matrix);
      tint.setHex(0x9a6948);
      instanced.setColorAt(idx++, tint);

      // Operator Cab / Counterweight
      dummy.position.set(c.x - Math.cos(c.yaw) * 8, c.h - 5.5, c.z + Math.sin(c.yaw) * 8);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.scale.set(6.5, 4.0, 3.6);
      dummy.updateMatrix();
      instanced.setMatrixAt(idx, dummy.matrix);
      tint.setHex(0x525d68);
      instanced.setColorAt(idx++, tint);
    }

    instanced.instanceMatrix.needsUpdate = true;
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
    return instanced;
  }

  /**
   * Configures warm late-afternoon Mediterranean lighting & hides procedural skyline
   * because de_dust2.glb supplies its own Blender desert hills and skyline backdrop.
   */
  public configureDust2Atmosphere(): void {
    this.horizonMesh.visible = false;
    this.worldScene.fog = new THREE.FogExp2(0xe6d8c3, 0.0018);
    this.hemiLight.color.setHex(0xc8dcf4);
    this.hemiLight.groundColor.setHex(0x8a7254);
    this.hemiLight.intensity = 0.88;

    this.sunLight.color.setHex(0xffe6c8);
    this.sunLight.intensity = 2.15;
    this.sunLight.position.set(52, 56, 42);
    this.sunLight.target.position.set(-22, 3.5, 6);
    this.sunLight.target.updateMatrixWorld();

    const d = 64;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.camera.updateProjectionMatrix();
  }

  public update(dt: number, cameraPos: THREE.Vector3, currentZone?: string): void {
    this.skyMesh.position.copy(cameraPos);
    if (this.horizonMesh.visible) {
      this.horizonMesh.position.set(cameraPos.x, 0, cameraPos.z);
    }
    if (currentZone) {
      this.viewmodelLighting.update(dt, currentZone);
    }
  }

  public applyQualityTier(tier: QualityTier): void {
    const effectiveTier: QualityTier = this.isSoftwareGl ? 'LOW' : tier;
    this.activeQualityTier = effectiveTier;

    const nativeDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    let dpr = 1;
    let shadowsEnabled = false;
    let shadowSize = 1024;

    switch (effectiveTier) {
      case 'POTATO':
        dpr = 0.75;
        shadowsEnabled = false;
        shadowSize = 512;
        break;
      case 'LOW':
        dpr = 1.0;
        shadowsEnabled = !this.isSoftwareGl;
        shadowSize = 1024;
        break;
      case 'MEDIUM':
        dpr = Math.min(nativeDpr, 1.35);
        shadowsEnabled = !this.isSoftwareGl;
        shadowSize = 1024;
        break;
      case 'HIGH':
      default:
        dpr = Math.min(nativeDpr, 2.0);
        shadowsEnabled = !this.isSoftwareGl;
        shadowSize = 2048;
        break;
    }

    this.currentDpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.shadowMap.enabled = shadowsEnabled;
    this.sunLight.castShadow = shadowsEnabled;
    if (shadowsEnabled && this.sunLight.shadow.mapSize.width !== shadowSize) {
      this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.postProcess.setQualityTier(effectiveTier);
  }

  public updateViewmodelProjection(w: number, h: number): void {
    const aspect = w / Math.max(1, h);
    this.viewmodelCamera.aspect = aspect;
    if (aspect < 1.35) {
      const targetHFovRad = THREE.MathUtils.degToRad(92);
      const vFovDeg = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(targetHFovRad * 0.5) / aspect)
      );
      this.viewmodelCamera.fov = THREE.MathUtils.clamp(vFovDeg, 62, 96);
    } else {
      this.viewmodelCamera.fov = 62;
    }
    this.viewmodelCamera.updateProjectionMatrix();
  }

  public onResize(w: number, h: number): void {
    this.updateViewmodelProjection(w, h);
    this.postProcess.setSize(w, h);
  }

  public render(renderViewmodel: boolean): void {
    this.postProcess.render(
      this.worldScene,
      this.worldCamera,
      this.viewmodelScene,
      this.viewmodelCamera,
      renderViewmodel
    );
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
    this.postProcess.dispose();
  }
}
