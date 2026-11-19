import { WEAPONS, WeaponDef } from '@garam/shared';
import { settingsStore, CrosshairConfig } from '../core/SettingsStore.js';

export interface CustomizerCallbacks {
  onCrosshairChanged: (config: CrosshairConfig) => void;
  onGrantCash: () => void;
  onToggleInfiniteAmmo: (enabled: boolean) => void;
  onToggleShowImpacts: (enabled: boolean) => void;
  onToggleFreezeBots: (frozen: boolean) => void;
  onRespawnBots: () => void;
  onExit: () => void;
}

export class CustomizerUI {
  private modal: HTMLElement;
  private callbacks: CustomizerCallbacks;
  public isOpen = false;

  // Sandbox state
  public infiniteAmmo = false;
  public showImpacts = false;
  public freezeBots = false;

  // Cached original weapon specs for reset
  private originalWeapons: Record<string, WeaponDef> = {};

  constructor(callbacks: CustomizerCallbacks) {
    this.callbacks = callbacks;

    // Cache pristine weapon stats
    for (const key of Object.keys(WEAPONS)) {
      this.originalWeapons[key] = { ...WEAPONS[key], sprayPattern: [...WEAPONS[key].sprayPattern] };
    }

    this.modal = this.createModalDOM();
    document.body.appendChild(this.modal);
    this.bindEvents();
    this.renderCrosshairPreview();
  }

  private createModalDOM(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'customizer-modal';
    el.style.position = 'fixed';
    el.style.top = '50%';
    el.style.left = '50%';
    el.style.transform = 'translate(-50%, -50%)';
    el.style.width = '780px';
    el.style.maxHeight = '88vh';
    el.style.background = 'rgba(10, 14, 20, 0.94)';
    el.style.backdropFilter = 'blur(20px)';
    el.style.border = '1px solid rgba(59, 158, 255, 0.3)';
    el.style.borderRadius = '8px';
    el.style.boxShadow = '0 0 60px rgba(0, 0, 0, 0.9), inset 0 0 20px rgba(0, 0, 0, 0.7)';
    el.style.color = '#fff';
    el.style.fontFamily = 'sans-serif';
    el.style.zIndex = '90';
    el.style.display = 'none';
    el.style.flexDirection = 'column';
    el.style.overflow = 'hidden';

    el.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; border-bottom: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.3);">
        <div style="font-size: 16px; font-weight: 800; letter-spacing: 2px; color: #3b9eff;">GARAM ESPORTS SANDBOX & CUSTOMIZER [F2]</div>
        <button id="cust-close-btn" style="background: none; border: none; color: #8892a0; font-size: 18px; cursor: pointer;">✕</button>
      </div>

      <div style="display: flex; gap: 8px; padding: 12px 24px 0; border-bottom: 1px solid rgba(255,255,255,0.08);">
        <button class="cust-tab-btn active" data-tab="tab-crosshair">CROSSHAIR STUDIO</button>
        <button class="cust-tab-btn" data-tab="tab-weapons">WEAPON & BALLISTICS LAB</button>
        <button class="cust-tab-btn" data-tab="tab-sandbox">PRACTICE SANDBOX</button>
      </div>

      <div style="padding: 20px 24px; overflow-y: auto; flex: 1;">
        <!-- TAB 1: CROSSHAIR -->
        <div id="tab-crosshair" class="cust-tab-content">
          <div style="display: flex; gap: 24px;">
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center;">
              <canvas id="cust-ch-canvas" width="220" height="220" style="background: #11141a; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; box-shadow: inset 0 0 20px #000;"></canvas>
              <div style="margin-top: 14px; display: flex; gap: 8px;">
                <button class="cust-btn" id="cust-ch-export">COPY JSON</button>
                <button class="cust-btn" id="cust-ch-reset">RESET</button>
              </div>
            </div>

            <div style="flex: 1.4; display: flex; flex-direction: column; gap: 8px; font-size: 12px;">
              <div class="cust-row"><span>LENGTH</span><input type="range" id="ch-len" min="2" max="20" step="1"><span id="ch-len-v">8</span></div>
              <div class="cust-row"><span>THICKNESS</span><input type="range" id="ch-thick" min="1" max="6" step="1"><span id="ch-thick-v">2</span></div>
              <div class="cust-row"><span>GAP</span><input type="range" id="ch-gap" min="0" max="16" step="1"><span id="ch-gap-v">4</span></div>
              <div class="cust-row"><span>COLOR</span><input type="color" id="ch-color" value="#00ff66" style="cursor: pointer; width: 44px; height: 26px; border: none; background: none;"></div>
              <div class="cust-row"><span>CENTER DOT</span><input type="checkbox" id="ch-dot"></div>
              <div class="cust-row"><span>OUTLINE</span><input type="checkbox" id="ch-outline" checked></div>
              <div class="cust-row"><span>DYNAMIC SPREAD</span><input type="checkbox" id="ch-dyn" checked></div>
            </div>
          </div>
        </div>

        <!-- TAB 2: WEAPONS LAB -->
        <div id="tab-weapons" class="cust-tab-content" style="display: none;">
          <div style="margin-bottom: 14px; display: flex; gap: 8px;">
            <select id="cust-wp-select" style="background: #11141a; border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 6px 12px; border-radius: 4px; font-size: 13px;">
              <option value="garam-47">Garam-47 (AK-47)</option>
              <option value="vanguard-m4">Vanguard M4A1-S</option>
              <option value="sovereign-awp">Sovereign AWP</option>
              <option value="desert-eagle">Desert Eagle</option>
              <option value="garam-karambit">Garam Crimson Karambit</option>
            </select>
            <button class="cust-btn" id="cust-wp-reset">RESET DEFAULTS</button>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 12px;">
            <div class="cust-row"><span>DAMAGE</span><input type="number" id="wp-dmg" style="width: 70px;"></div>
            <div class="cust-row"><span>RATE OF FIRE (RPM)</span><input type="number" id="wp-rpm" style="width: 70px;"></div>
            <div class="cust-row"><span>MAGAZINE SIZE</span><input type="number" id="wp-mag" style="width: 70px;"></div>
            <div class="cust-row"><span>RELOAD TIME (S)</span><input type="number" id="wp-reload" step="0.1" style="width: 70px;"></div>
            <div class="cust-row"><span>MOVE SPEED (M/S)</span><input type="number" id="wp-speed" step="0.1" style="width: 70px;"></div>
            <div class="cust-row"><span>ARMOR PENETRATION</span><input type="number" id="wp-pen" step="0.01" style="width: 70px;"></div>
          </div>
        </div>

        <!-- TAB 3: SANDBOX PRACTICE -->
        <div id="tab-sandbox" class="cust-tab-content" style="display: none;">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
            <button class="cust-toggle-card" id="sb-cash">
              <div style="font-weight: 700; color: #00ff88;">+ $16,000 CASH</div>
              <div style="font-size: 11px; color: #8892a0;">Max competitive requisitions</div>
            </button>
            <button class="cust-toggle-card" id="sb-ammo">
              <div style="font-weight: 700; color: #3b9eff;">INFINITE AMMO: OFF</div>
              <div style="font-size: 11px; color: #8892a0;">Never deplete magazine</div>
            </button>
            <button class="cust-toggle-card" id="sb-impacts">
              <div style="font-weight: 700; color: #ffaa00;">SHOW IMPACTS: OFF</div>
              <div style="font-size: 11px; color: #8892a0;">sv_showimpacts 3D raycast markers</div>
            </button>
            <button class="cust-toggle-card" id="sb-freeze">
              <div style="font-weight: 700; color: #ff334b;">FREEZE BOTS: OFF</div>
              <div style="font-size: 11px; color: #8892a0;">Halt all AI movement & fire</div>
            </button>
            <button class="cust-toggle-card" id="sb-respawn" style="grid-column: span 2;">
              <div style="font-weight: 700; color: #fff;">RESPAWN ALL BOTS</div>
              <div style="font-size: 11px; color: #8892a0;">Reset 5v5 rosters to spawn coordinates</div>
            </button>
          </div>
        </div>
      </div>
    `;

    // Inject styles
    const style = document.createElement('style');
    style.innerHTML = `
      .cust-tab-btn {
        padding: 8px 16px;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: #8892a0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 1px;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .cust-tab-btn.active {
        color: #3b9eff;
        border-bottom-color: #3b9eff;
      }
      .cust-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(255,255,255,0.03);
        padding: 6px 12px;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.06);
      }
      .cust-btn {
        padding: 6px 14px;
        background: rgba(59, 158, 255, 0.2);
        border: 1px solid #3b9eff;
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        border-radius: 4px;
        cursor: pointer;
      }
      .cust-btn:hover { background: #3b9eff; }
      .cust-toggle-card {
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(255,255,255,0.1);
        padding: 14px;
        border-radius: 6px;
        cursor: pointer;
        text-align: left;
        transition: all 0.15s ease;
      }
      .cust-toggle-card:hover {
        background: rgba(255,255,255,0.08);
      }
    `;
    document.head.appendChild(style);

    return el;
  }

  private bindEvents(): void {
    // Close button
    this.modal.querySelector('#cust-close-btn')?.addEventListener('click', () => this.toggle(false));

    // Tab switching
    const tabBtns = this.modal.querySelectorAll('.cust-tab-btn');
    tabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const targetId = btn.getAttribute('data-tab');
        this.modal.querySelectorAll('.cust-tab-content').forEach((c) => {
          (c as HTMLElement).style.display = c.id === targetId ? 'block' : 'none';
        });
      });
    });

    // Crosshair inputs
    const ch = settingsStore.settings.crosshair;
    const lenInput = this.modal.querySelector('#ch-len') as HTMLInputElement;
    const thickInput = this.modal.querySelector('#ch-thick') as HTMLInputElement;
    const gapInput = this.modal.querySelector('#ch-gap') as HTMLInputElement;
    const colorInput = this.modal.querySelector('#ch-color') as HTMLInputElement;
    const dotInput = this.modal.querySelector('#ch-dot') as HTMLInputElement;
    const outlineInput = this.modal.querySelector('#ch-outline') as HTMLInputElement;
    const dynInput = this.modal.querySelector('#ch-dyn') as HTMLInputElement;

    lenInput.value = ch.length.toString();
    thickInput.value = ch.thickness.toString();
    gapInput.value = ch.gap.toString();
    colorInput.value = ch.color;
    dotInput.checked = ch.centerDot;
    outlineInput.checked = ch.outline;
    dynInput.checked = ch.dynamicSpread;

    const onChUpdate = () => {
      ch.length = parseInt(lenInput.value, 10);
      ch.thickness = parseInt(thickInput.value, 10);
      ch.gap = parseInt(gapInput.value, 10);
      ch.color = colorInput.value;
      ch.centerDot = dotInput.checked;
      ch.outline = outlineInput.checked;
      ch.dynamicSpread = dynInput.checked;

      this.modal.querySelector('#ch-len-v')!.textContent = ch.length.toString();
      this.modal.querySelector('#ch-thick-v')!.textContent = ch.thickness.toString();
      this.modal.querySelector('#ch-gap-v')!.textContent = ch.gap.toString();

      settingsStore.update('crosshair', ch);
      this.callbacks.onCrosshairChanged(ch);
      this.renderCrosshairPreview();
    };

    [lenInput, thickInput, gapInput, colorInput, dotInput, outlineInput, dynInput].forEach((el) => {
      el.addEventListener('input', onChUpdate);
    });

    // Copy JSON
    this.modal.querySelector('#cust-ch-export')?.addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(ch, null, 2));
      alert('Crosshair JSON copied to clipboard!');
    });

    // Weapon select
    const wpSelect = this.modal.querySelector('#cust-wp-select') as HTMLSelectElement;
    const populateWeaponFields = (wpId: string) => {
      const def = WEAPONS[wpId];
      if (!def) return;
      (this.modal.querySelector('#wp-dmg') as HTMLInputElement).value = def.damage.toString();
      (this.modal.querySelector('#wp-rpm') as HTMLInputElement).value = def.fireRateRpm.toString();
      (this.modal.querySelector('#wp-mag') as HTMLInputElement).value = def.magCapacity.toString();
      (this.modal.querySelector('#wp-reload') as HTMLInputElement).value = def.reloadTime.toString();
      (this.modal.querySelector('#wp-speed') as HTMLInputElement).value = def.movementSpeed.toString();
      (this.modal.querySelector('#wp-pen') as HTMLInputElement).value = def.armorPenetration.toString();
    };

    wpSelect.addEventListener('change', () => populateWeaponFields(wpSelect.value));
    populateWeaponFields('garam-47');

    const updateWpField = (field: keyof WeaponDef, val: number) => {
      const def = WEAPONS[wpSelect.value];
      if (def) {
        (def as unknown as Record<string, number>)[field] = val;
      }
    };

    this.modal.querySelector('#wp-dmg')?.addEventListener('change', (e) => updateWpField('damage', parseFloat((e.target as HTMLInputElement).value)));
    this.modal.querySelector('#wp-rpm')?.addEventListener('change', (e) => updateWpField('fireRateRpm', parseFloat((e.target as HTMLInputElement).value)));
    this.modal.querySelector('#wp-mag')?.addEventListener('change', (e) => updateWpField('magCapacity', parseInt((e.target as HTMLInputElement).value, 10)));
    this.modal.querySelector('#wp-reload')?.addEventListener('change', (e) => updateWpField('reloadTime', parseFloat((e.target as HTMLInputElement).value)));
    this.modal.querySelector('#wp-speed')?.addEventListener('change', (e) => updateWpField('movementSpeed', parseFloat((e.target as HTMLInputElement).value)));
    this.modal.querySelector('#wp-pen')?.addEventListener('change', (e) => updateWpField('armorPenetration', parseFloat((e.target as HTMLInputElement).value)));

    // Reset weapon
    this.modal.querySelector('#cust-wp-reset')?.addEventListener('click', () => {
      const wpId = wpSelect.value;
      if (this.originalWeapons[wpId]) {
        Object.assign(WEAPONS[wpId], this.originalWeapons[wpId]);
        populateWeaponFields(wpId);
      }
    });

    // Sandbox buttons
    this.modal.querySelector('#sb-cash')?.addEventListener('click', () => this.callbacks.onGrantCash());
    this.modal.querySelector('#sb-ammo')?.addEventListener('click', () => {
      this.infiniteAmmo = !this.infiniteAmmo;
      const el = this.modal.querySelector('#sb-ammo div:first-child')!;
      el.textContent = `INFINITE AMMO: ${this.infiniteAmmo ? 'ON' : 'OFF'}`;
      this.callbacks.onToggleInfiniteAmmo(this.infiniteAmmo);
    });
    this.modal.querySelector('#sb-impacts')?.addEventListener('click', () => {
      this.showImpacts = !this.showImpacts;
      const el = this.modal.querySelector('#sb-impacts div:first-child')!;
      el.textContent = `SHOW IMPACTS: ${this.showImpacts ? 'ON' : 'OFF'}`;
      this.callbacks.onToggleShowImpacts(this.showImpacts);
    });
    this.modal.querySelector('#sb-freeze')?.addEventListener('click', () => {
      this.freezeBots = !this.freezeBots;
      const el = this.modal.querySelector('#sb-freeze div:first-child')!;
      el.textContent = `FREEZE BOTS: ${this.freezeBots ? 'ON' : 'OFF'}`;
      this.callbacks.onToggleFreezeBots(this.freezeBots);
    });
    this.modal.querySelector('#sb-respawn')?.addEventListener('click', () => this.callbacks.onRespawnBots());
  }

  private renderCrosshairPreview(): void {
    const canvas = this.modal.querySelector('#cust-ch-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Subtle background grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    const ch = settingsStore.settings.crosshair;
    const len = ch.length;
    const thick = ch.thickness;
    const gap = ch.gap;

    if (ch.outline) {
      ctx.fillStyle = '#000000';
      // Outline around 4 bars
      ctx.fillRect(cx - (thick / 2) - 1, cy - gap - len - 1, thick + 2, len + 2);
      ctx.fillRect(cx - (thick / 2) - 1, cy + gap - 1, thick + 2, len + 2);
      ctx.fillRect(cx - gap - len - 1, cy - (thick / 2) - 1, len + 2, thick + 2);
      ctx.fillRect(cx + gap - 1, cy - (thick / 2) - 1, len + 2, thick + 2);
    }

    ctx.fillStyle = ch.color;
    ctx.fillRect(cx - (thick / 2), cy - gap - len, thick, len);
    ctx.fillRect(cx - (thick / 2), cy + gap, thick, len);
    ctx.fillRect(cx - gap - len, cy - (thick / 2), len, thick);
    ctx.fillRect(cx + gap, cy - (thick / 2), len, thick);

    if (ch.centerDot) {
      if (ch.outline) {
        ctx.fillStyle = '#000000';
        ctx.fillRect(cx - (thick / 2) - 1, cy - (thick / 2) - 1, thick + 2, thick + 2);
      }
      ctx.fillStyle = ch.color;
      ctx.fillRect(cx - (thick / 2), cy - (thick / 2), thick, thick);
    }
  }

  public toggle(force?: boolean): void {
    this.isOpen = force !== undefined ? force : !this.isOpen;
    this.modal.style.display = this.isOpen ? 'flex' : 'none';
    if (!this.isOpen) {
      this.callbacks.onExit();
    }
  }
}
