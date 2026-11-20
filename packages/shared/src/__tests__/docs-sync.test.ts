import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WEAPONS } from '../constants/weapons.js';
import { HITBOX } from '../constants/kinematics.js';

describe('Living Documentation & Architecture Parity (README.md)', () => {
  const readmePath = path.resolve(__dirname, '../../../../README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf-8');

  it('guarantees README weapon telemetry matches shared kernel WEAPONS constants', () => {
    const headMult = HITBOX.HEAD_MULTIPLIER;

    const ak = WEAPONS['garam-47'];
    expect(readmeContent).toContain(`${ak.damage} / ${Math.round(ak.damage * headMult)} HP`);
    expect(readmeContent).toContain(`${ak.magCapacity} / ${ak.reserveAmmo}`);

    const m4 = WEAPONS['vanguard-m4'];
    expect(readmeContent).toContain(`${m4.damage} / ${Math.round(m4.damage * headMult)} HP`);
    expect(readmeContent).toContain(`${m4.fireRateRpm}`);
    expect(readmeContent).toContain(`${m4.magCapacity} / ${m4.reserveAmmo}`);

    const awp = WEAPONS['sovereign-awp'];
    expect(readmeContent).toContain(`${awp.damage} / ${Math.round(awp.damage * headMult)} HP`);
    expect(readmeContent).toContain(`${awp.magCapacity} / ${awp.reserveAmmo}`);

    const deagle = WEAPONS['desert-eagle'];
    expect(readmeContent).toContain(`${deagle.damage} / ${Math.round(deagle.damage * headMult)} HP`);
    expect(readmeContent).toContain(`${deagle.magCapacity} / ${deagle.reserveAmmo}`);

    const knife = WEAPONS['garam-karambit'];
    expect(readmeContent).toContain(`${knife.damage} / ${knife.damage} (180 Backstab)`);
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
