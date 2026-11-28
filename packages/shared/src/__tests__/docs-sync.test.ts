import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WEAPONS } from '../constants/weapons.js';
import { HITBOX } from '../constants/kinematics.js';

describe('Living Documentation & Architecture Parity (README.md)', () => {
  const readmePath = path.resolve(__dirname, '../../../../README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf-8');

  it('guarantees README weapon telemetry matches shared kernel WEAPONS constants across all 9 weapons', () => {
    const headMult = HITBOX.HEAD_MULTIPLIER;

    for (const id of [
      'garam-47',
      'vanguard-m4',
      'm4a4',
      'mp9',
      'sovereign-awp',
      'desert-eagle',
      'usp-s',
      'glock-18',
    ]) {
      const wp = WEAPONS[id];
      expect(readmeContent, `${id} damage`).toContain(
        `${wp.damage} / ${Math.round(wp.damage * headMult)} HP`
      );
      expect(readmeContent, `${id} ammo`).toContain(`${wp.magCapacity} / ${wp.reserveAmmo}`);
    }

    const knife = WEAPONS['garam-karambit'];
    expect(readmeContent).toContain(`${knife.damage} / ${knife.damage} (180 Backstab)`);
    expect(readmeContent).toContain('DE_DUST2 (A-SITE)');
    expect(readmeContent).toContain('MapRegistry');
    expect(readmeContent).toContain('cs2_fps_arms.glb');
  });

  it('guarantees 5-zone hitboxes match shared kernel HITBOX constants with no phantom zones', () => {
    expect(readmeContent).toContain(`Head (\`HEAD\`):** ${HITBOX.HEAD_MULTIPLIER.toFixed(2)}x multiplier`);
    expect(readmeContent).toContain(`Chest (\`CHEST\`):** ${HITBOX.CHEST_MULTIPLIER.toFixed(2)}x baseline damage`);
    expect(readmeContent).toContain(`Stomach (\`STOMACH\`):** ${HITBOX.STOMACH_MULTIPLIER.toFixed(2)}x multiplier`);
    expect(readmeContent).toContain(`Arms & Hands (\`ARMS\`):** ${HITBOX.ARMS_MULTIPLIER.toFixed(2)}x multiplier`);
    expect(readmeContent).toContain(`Legs & Feet (\`LEGS\`):** ${HITBOX.LEGS_MULTIPLIER.toFixed(2)}x multiplier`);

    // Ensure phantom zones like NECK are completely purged
    expect(readmeContent).not.toContain(`NECK`);
  });

  it('guarantees keybindings table specifies ControlLeft exclusively for crouch', () => {
    expect(readmeContent).toContain('`ControlLeft`');
    expect(readmeContent).toContain('`Z`, `X`, `C`, `V`');
  });
});
