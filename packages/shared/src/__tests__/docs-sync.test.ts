import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WEAPONS } from '../constants/weapons.js';
import { HITBOX } from '../constants/kinematics.js';

describe('Living Documentation & Architecture Parity (README.md)', () => {
  const readmePath = path.resolve(__dirname, '../../../../README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf-8');

  it('guarantees README weapon telemetry matches shared kernel WEAPONS constants', () => {
    // Garam-47
    expect(readmeContent).toContain(`36 / 144 HP`);
    expect(readmeContent).toContain(`30 / 90`);

    // Vanguard M4A1-S
    expect(readmeContent).toContain(`33 / 132 HP`);
    expect(readmeContent).toContain(`666`);
    expect(readmeContent).toContain(`25 / 75`);

    // Sovereign AWP
    expect(readmeContent).toContain(`115 / 450 HP`);
    expect(readmeContent).toContain(`5 / 30`);

    // Desert Eagle
    expect(readmeContent).toContain(`53 / 212 HP`);
    expect(readmeContent).toContain(`7 / 35`);

    // Crimson Karambit
    expect(readmeContent).toContain(`55 / 55 (180 Backstab)`);
  });

  it('guarantees 5-zone hitboxes match shared kernel HITBOX constants with no phantom zones', () => {
    expect(readmeContent).toContain(`Head (\`HEAD\`):** 4.00x multiplier`);
    expect(readmeContent).toContain(`Chest (\`CHEST\`):** 1.00x baseline damage`);
    expect(readmeContent).toContain(`Stomach (\`STOMACH\`):** 1.15x multiplier`);
    expect(readmeContent).toContain(`Arms & Hands (\`ARMS\`):** 0.75x multiplier`);
    expect(readmeContent).toContain(`Legs & Feet (\`LEGS\`):** 0.75x multiplier`);

    // Ensure phantom zones like NECK are completely purged
    expect(readmeContent).not.toContain(`NECK`);
  });

  it('guarantees keybindings table specifies ControlLeft exclusively for crouch', () => {
    expect(readmeContent).toContain('`ControlLeft`');
    expect(readmeContent).toContain('`Z`, `X`, `C`, `V`');
  });
});
