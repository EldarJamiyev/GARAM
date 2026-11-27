import * as THREE from 'three';

/**
 * Clean-room articulated 3D Hostage character rig for CS_OFFICE Hostage Rescue mode.
 * Distinct silhouette from combat operators (tan trench coat / white dress shirt + tie)
 * with idle nervous sway and following jog gait.
 */
export class HostageRig {
  public readonly root = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly leftArm = new THREE.Group();
  private readonly rightArm = new THREE.Group();
  private readonly leftLeg = new THREE.Group();
  private readonly rightLeg = new THREE.Group();
  private readonly statusRing: THREE.Mesh;
  private animPhase = Math.random() * Math.PI * 2;

  constructor(name: string) {
    this.root.name = `hostage_${name}`;

    const coatMat = new THREE.MeshStandardMaterial({ color: 0x9c8970, roughness: 0.78, metalness: 0.05 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.72, metalness: 0.02 });
    const tieMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.55, metalness: 0.1 });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x262a30, roughness: 0.82, metalness: 0.05 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xdab294, roughness: 0.68, metalness: 0.02 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a221d, roughness: 0.85, metalness: 0.02 });

    // Legs (hip at y = 0.86m)
    const makeLeg = (side: -1 | 1, pivot: THREE.Group) => {
      pivot.position.set(side * 0.10, 0.86, 0);
      const legMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.84, 0.15), pantsMat);
      legMesh.position.y = -0.42;
      legMesh.castShadow = true;
      pivot.add(legMesh);
      this.root.add(pivot);
    };
    makeLeg(-1, this.leftLeg);
    makeLeg(1, this.rightLeg);

    // Torso (y = 0.86 -> 1.48m)
    this.torso.position.set(0, 0.86, 0);
    const jacket = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.62, 0.22), coatMat);
    jacket.position.y = 0.31;
    jacket.castShadow = true;
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.45, 0.23), shirtMat);
    shirt.position.set(0, 0.36, 0.01);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.24), tieMat);
    tie.position.set(0, 0.34, 0.015);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), skinMat);
    head.position.set(0, 0.76, 0);
    head.castShadow = true;
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.08, 0.23), hairMat);
    hair.position.set(0, 0.86, -0.01);
    this.torso.add(jacket, shirt, tie, head, hair);

    const makeArm = (side: -1 | 1, pivot: THREE.Group) => {
      pivot.position.set(side * 0.24, 0.56, 0);
      const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.52, 0.11), coatMat);
      sleeve.position.y = -0.24;
      sleeve.castShadow = true;
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.10, 0.09), skinMat);
      hand.position.y = -0.52;
      pivot.add(sleeve, hand);
      this.torso.add(pivot);
    };
    makeArm(-1, this.leftArm);
    makeArm(1, this.rightArm);

    this.root.add(this.torso);

    // Subtle ground indicator ring (amber = waiting, emerald = following)
    const ringGeo = new THREE.RingGeometry(0.42, 0.50, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, side: THREE.DoubleSide, transparent: true, opacity: 0.72 });
    this.statusRing = new THREE.Mesh(ringGeo, ringMat);
    this.statusRing.position.y = 0.03;
    this.root.add(this.statusRing);
  }

  public update(dt: number, isFollowing: boolean, moveSpeed: number): void {
    this.animPhase += dt * (moveSpeed > 0.3 ? 10.5 : 2.2);
    const mat = this.statusRing.material as THREE.MeshBasicMaterial;
    mat.color.setHex(isFollowing ? 0x10b981 : 0xf59e0b);

    if (moveSpeed > 0.3) {
      const swing = Math.sin(this.animPhase) * 0.55;
      this.leftLeg.rotation.x = swing;
      this.rightLeg.rotation.x = -swing;
      this.leftArm.rotation.x = -swing * 0.75;
      this.rightArm.rotation.x = swing * 0.75;
      this.torso.position.y = 0.86 + Math.abs(Math.cos(this.animPhase)) * 0.03;
    } else {
      // Surrendered/nervous stance
      this.leftLeg.rotation.x = 0;
      this.rightLeg.rotation.x = 0;
      this.leftArm.rotation.x = -0.35 + Math.sin(this.animPhase) * 0.05;
      this.rightArm.rotation.x = -0.35 - Math.sin(this.animPhase) * 0.05;
      this.torso.position.y = 0.86;
    }
  }

  public dispose(): void {
    const disposedMats = new Set<THREE.Material>();
    this.root.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = obj as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const x of mats) {
          if (x && !disposedMats.has(x)) {
            disposedMats.add(x);
            x.dispose();
          }
        }
      }
    });
  }
}
