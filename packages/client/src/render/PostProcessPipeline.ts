import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * CS2 Source 2 Post-Processing Optical Pipeline
 *
 * Implements Ground Truth Ambient Occlusion (GTAO) for deep crevice shading,
 * selective filmic bloom for direct solar reflections, and dual-pass depth isolation
 * for first-person viewmodels (zero wall clipping, zero SSAO haloing).
 */
export class PostProcessPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly isSoftwareGl: boolean;
  private composer: EffectComposer | null = null;
  private gtaoPass: GTAOPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private outputPass: OutputPass | null = null;

  constructor(
    renderer: THREE.WebGLRenderer,
    worldScene: THREE.Scene,
    worldCamera: THREE.PerspectiveCamera,
    isSoftwareGl: boolean
  ) {
    this.renderer = renderer;
    this.isSoftwareGl = isSoftwareGl;

    if (!this.isSoftwareGl) {
      try {
        const width = window.innerWidth;
        const height = window.innerHeight;

        const renderTarget = new THREE.WebGLRenderTarget(width, height, {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.HalfFloatType,
          samples: 4,
        });

        this.composer = new EffectComposer(renderer, renderTarget);

        // 1. World Scene Base Render Pass
        this.renderPass = new RenderPass(worldScene, worldCamera);
        this.composer.addPass(this.renderPass);

        // 2. Ground Truth Ambient Occlusion (GTAO) for deep contact crevice shading
        this.gtaoPass = new GTAOPass(worldScene, worldCamera, width, height);
        this.gtaoPass.blendIntensity = 1.45;
        this.composer.addPass(this.gtaoPass);

        // 3. Selective Filmic Bloom (Threshold 1.08: only specular glints & sun flare bloom)
        this.bloomPass = new UnrealBloomPass(
          new THREE.Vector2(width, height),
          0.12,  // subtle strength
          0.38,  // radius
          1.08   // threshold
        );
        this.composer.addPass(this.bloomPass);

        // 4. Output Pass (Color space & ACES Filmic tone mapping)
        this.outputPass = new OutputPass();
        this.composer.addPass(this.outputPass);
      } catch {
        console.warn('[PostProcessPipeline] WebGL2 post-processing disabled, falling back to direct pipeline.');
        this.composer = null;
      }
    }
  }

  public setSize(width: number, height: number): void {
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.gtaoPass) {
      this.gtaoPass.setSize(width, height);
    }
  }

  public render(
    worldScene: THREE.Scene,
    worldCamera: THREE.PerspectiveCamera,
    viewmodelScene: THREE.Scene,
    viewmodelCamera: THREE.PerspectiveCamera,
    renderViewmodel: boolean
  ): void {
    if (this.composer && !this.isSoftwareGl) {
      if (this.renderPass) {
        this.renderPass.scene = worldScene;
        this.renderPass.camera = worldCamera;
      }
      if (this.gtaoPass) {
        this.gtaoPass.scene = worldScene;
        this.gtaoPass.camera = worldCamera;
      }
      this.composer.render();
    } else {
      this.renderer.clear();
      this.renderer.render(worldScene, worldCamera);
    }

    // Dual-pass depth isolation: render viewmodels on top with clearDepth()
    this.renderer.clearDepth();
    if (renderViewmodel) {
      this.renderer.render(viewmodelScene, viewmodelCamera);
    }
  }

  public dispose(): void {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }
}
