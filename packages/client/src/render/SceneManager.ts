import * as THREE from 'three';

export class SceneManager {
  public worldScene: THREE.Scene;
  public worldCamera: THREE.PerspectiveCamera;
  public viewmodelScene: THREE.Scene;
  public viewmodelCamera: THREE.PerspectiveCamera;
  public sunLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;
  public skyMesh: THREE.Mesh;
  public horizonGroup: THREE.Group;
  public envMap: THREE.Texture;

  constructor(renderer: THREE.WebGLRenderer) {
    // 1. World Scene & Camera
    this.worldScene = new THREE.Scene();
    this.worldCamera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.05, 600);

    // 2. Viewmodel Scene & Camera (Dual-pass at 68 deg FOV)
    this.viewmodelScene = new THREE.Scene();
    this.viewmodelCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.01, 10);

    // 3. PMREM Image-Based Lighting (IBL)
    this.envMap = this.generateProceduralPMREM(renderer);
    this.worldScene.environment = this.envMap;
    this.viewmodelScene.environment = this.envMap;

    // 4. Calibrated Sun & Ambient Lighting
    this.hemiLight = new THREE.HemisphereLight(0xddeeff, 0x444b54, 0.85);
    this.worldScene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff3e0, 1.45);
    this.sunLight.position.set(55, 80, 40);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 1.0;
    this.sunLight.shadow.camera.far = 220;
    this.sunLight.shadow.bias = -0.00012;
    this.sunLight.shadow.normalBias = 0.02;

    const d = 68;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.worldScene.add(this.sunLight);

    // Viewmodel crisp 3-point lighting rig (Key + Rim + Hemisphere Fill)
    const vmHemi = new THREE.HemisphereLight(0xddeeff, 0x444b54, 1.05);
    this.viewmodelScene.add(vmHemi);

    const vmKey = new THREE.DirectionalLight(0xfffaed, 1.45);
    vmKey.position.set(2.5, 4.5, 3.0);
    this.viewmodelScene.add(vmKey);

    const vmRim = new THREE.DirectionalLight(0x88ccff, 0.95);
    vmRim.position.set(-3.5, 2.5, -2.5);
    this.viewmodelScene.add(vmRim);

    // 5. Atmospheric Gradient Sky Dome with Sun Disc
    this.skyMesh = this.buildAtmosphericSky();
    this.worldScene.add(this.skyMesh);

    // 6. Distant Low-Poly Industrial Horizon Silhouette
    this.horizonGroup = this.buildDistantHorizon();
    this.worldScene.add(this.horizonGroup);
  }

  /**
   * Generates a realistic PMREM specular environment cube texture procedurally
   */
  private generateProceduralPMREM(renderer: THREE.WebGLRenderer): THREE.Texture {
    const pmremGen = new THREE.PMREMGenerator(renderer);
    pmremGen.compileEquirectangularShader();

    const envScene = new THREE.Scene();

    // Zenith to horizon dome
    const geo = new THREE.SphereGeometry(100, 32, 16);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#1a5796'); // Azure zenith
    grad.addColorStop(0.55, '#89b6db'); // Mid sky
    grad.addColorStop(0.78, '#eaf2fa'); // Warm horizon
    grad.addColorStop(0.82, '#6b665c'); // Ground boundary
    grad.addColorStop(1.0, '#302d29'); // Earth bounce
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 256);

    // Sun disc in reflection map
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

    // Clean up temporary baking resources
    envScene.remove(envMesh);
    geo.dispose();
    envMat.dispose();
    tex.dispose();
    pmremGen.dispose();

    return envTarget.texture;
  }

  /**
   * Custom ShaderMaterial Atmospheric Sky with Horizon Fog & Sun Corona
   */
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

        // Gradient: Deep Azure Zenith -> Warm Horizon Haze -> Ground
        vec3 zenithColor = vec3(0.09, 0.34, 0.62);
        vec3 horizonColor = vec3(0.85, 0.91, 0.98);
        vec3 hazeColor = vec3(0.96, 0.88, 0.78);
        vec3 groundColor = vec3(0.24, 0.22, 0.20);

        vec3 sky = mix(horizonColor, zenithColor, clamp(pow(max(y, 0.0), 0.65), 0.0, 1.0));
        if (y < 0.0) {
          sky = mix(horizonColor, groundColor, clamp(-y * 6.0, 0.0, 1.0));
        }

        // Sun disc + corona
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
   * Distant low-poly industrial silhouette outside the 120m fortress perimeter
   */
  private buildDistantHorizon(): THREE.Group {
    const horizon = new THREE.Group();
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x485868,
      fog: false,
    });

    const radius = 175;
    const numStructures = 48;

    for (let i = 0; i < numStructures; i++) {
      const angle = (i / numStructures) * Math.PI * 2;
      const x = Math.cos(angle) * (radius + (Math.random() - 0.5) * 30);
      const z = Math.sin(angle) * (radius + (Math.random() - 0.5) * 30);

      const type = Math.random();
      let geo: THREE.BufferGeometry;

      if (type < 0.45) {
        // Warehouse building block
        const w = 18 + Math.random() * 24;
        const h = 14 + Math.random() * 32;
        const d = 16 + Math.random() * 18;
        geo = new THREE.BoxGeometry(w, h, d);
      } else if (type < 0.75) {
        // Industrial chimney / silo
        const r = 3 + Math.random() * 3.5;
        const h = 35 + Math.random() * 45;
        geo = new THREE.CylinderGeometry(r * 0.7, r, h, 8);
      } else {
        // Crane / radio tower truss
        const w = 4;
        const h = 45 + Math.random() * 35;
        geo = new THREE.BoxGeometry(w, h, w);
      }

      const mesh = new THREE.Mesh(geo, horizonMat);
      mesh.position.set(x, 10, z);
      mesh.rotation.y = Math.random() * Math.PI;
      horizon.add(mesh);
    }

    return horizon;
  }

  public update(dt: number, cameraPos: THREE.Vector3): void {
    // Keep sky dome and horizon centered on camera
    this.skyMesh.position.copy(cameraPos);
    this.horizonGroup.position.set(cameraPos.x, 0, cameraPos.z);
  }
}
