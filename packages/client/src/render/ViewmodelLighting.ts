import * as THREE from 'three';

/**
 * CS2 Dynamic Viewmodel Lighting Controller
 *
 * Smoothly transitions viewmodel lighting between direct golden outdoor sunlight
 * and cool slate shaded ambient occlusion when moving through arches, underpasses,
 * and tunnels.
 */
export class ViewmodelLighting {
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private currentSunRatio = 1.0;
  private targetSunRatio = 1.0;

  constructor(viewmodelScene: THREE.Scene) {
    // Primary key light angled from upper-right front (simulating sun altitude)
    this.keyLight = new THREE.DirectionalLight(0xfff0d8, 2.2);
    this.keyLight.position.set(1.2, 2.0, 1.5);
    viewmodelScene.add(this.keyLight);

    // Subtle sky fill light from lower-left (prevents completely crushed black shadows)
    this.fillLight = new THREE.DirectionalLight(0x8cb8e6, 0.45);
    this.fillLight.position.set(-1.0, -0.8, 1.0);
    viewmodelScene.add(this.fillLight);
  }

  public update(dt: number, currentZone: string): void {
    const isInterior =
      currentZone.includes('UNDERPASS') ||
      currentZone.includes('TUNNEL') ||
      currentZone.includes('PALACE') ||
      currentZone.includes('APARTMENTS');

    this.targetSunRatio = isInterior ? 0.35 : 1.0;
    this.currentSunRatio += (this.targetSunRatio - this.currentSunRatio) * Math.min(1.0, dt * 4.0);

    this.keyLight.intensity = THREE.MathUtils.lerp(0.85, 2.2, this.currentSunRatio);
    this.fillLight.intensity = THREE.MathUtils.lerp(0.65, 0.45, this.currentSunRatio);
  }
}
