import * as THREE from 'three';

/**
 * CS2 (Source 2) 3-Point Dynamic Viewmodel Lighting Controller
 *
 * Combines a warm sunlit Key Light, cool sky Fill Light, and crisp back-left Edge Rim Light
 * to separate brushed steel, slide serrations, scope glass, and Karambit bevels cleanly,
 * smoothly reacting to outdoor sun vs. shaded interiors and map palette.
 */
export class ViewmodelLighting {
  private readonly keyLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.DirectionalLight;
  private readonly rimLight: THREE.DirectionalLight;
  private currentSunRatio = 1.0;
  private targetSunRatio = 1.0;

  constructor(viewmodelScene: THREE.Scene) {
    // 1. Primary Warm Sun Key angled upper-right front
    this.keyLight = new THREE.DirectionalLight(0xfff1d8, 2.55);
    this.keyLight.position.set(1.6, 2.6, 1.8);
    viewmodelScene.add(this.keyLight);

    // 2. Cool Sky Fill from upper-left (keeps shadow sides crisp and readable)
    this.fillLight = new THREE.DirectionalLight(0x8fb8e8, 0.58);
    this.fillLight.position.set(-1.4, 0.9, 1.2);
    viewmodelScene.add(this.fillLight);

    // 3. Crisp CS2 Edge Rim catching top rail, iron sights, slide serrations, and Karambit spine
    this.rimLight = new THREE.DirectionalLight(0xdcebff, 1.15);
    this.rimLight.position.set(-0.8, 1.1, -0.6);
    viewmodelScene.add(this.rimLight);
  }

  public setMapStyle(map: 'de_dust2' | 'cs_office' | 'de_nuke' | 'de_inferno' | 'fy_snow'): void {
    if (map === 'de_dust2') {
      this.keyLight.color.setHex(0xfff1d8);
      this.fillLight.color.setHex(0x8fb8e8);
      this.rimLight.color.setHex(0xffefd6);
    } else if (map === 'de_inferno') {
      this.keyLight.color.setHex(0xffe9c8);
      this.fillLight.color.setHex(0x8db9e6);
      this.rimLight.color.setHex(0xffe4be);
    } else if (map === 'de_nuke') {
      this.keyLight.color.setHex(0xfff5e4);
      this.fillLight.color.setHex(0x97bfe4);
      this.rimLight.color.setHex(0xd6e8ff);
    } else {
      // cs_office & fy_snow crisp cool winter daylight
      this.keyLight.color.setHex(0xf6f9ff);
      this.fillLight.color.setHex(0x9ac2ee);
      this.rimLight.color.setHex(0xc2dcff);
    }
  }

  public update(dt: number, currentZone: string): void {
    const isInterior =
      currentZone.includes('UNDERPASS') ||
      currentZone.includes('TUNNEL') ||
      currentZone.includes('PALACE') ||
      currentZone.includes('APARTMENTS') ||
      currentZone.includes('OFFICE') ||
      currentZone.includes('HALL');

    this.targetSunRatio = isInterior ? 0.42 : 1.0;
    this.currentSunRatio += (this.targetSunRatio - this.currentSunRatio) * Math.min(1.0, dt * 4.5);

    this.keyLight.intensity = THREE.MathUtils.lerp(1.1, 2.55, this.currentSunRatio);
    this.fillLight.intensity = THREE.MathUtils.lerp(0.78, 0.55, this.currentSunRatio);
    this.rimLight.intensity = THREE.MathUtils.lerp(0.72, 1.18, this.currentSunRatio);
  }
}
