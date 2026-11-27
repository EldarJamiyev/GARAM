import { BotEntity } from '../maps/DeCitadelMap.js';
import { settingsStore } from '../core/SettingsStore.js';

export interface ScoreboardPlayer {
  id: string;
  name: string;
  team: 'Vanguard' | 'Syndicate';
  kills: number;
  deaths: number;
  assists: number;
  adr: number;
  cash: number;
  isAlive: boolean;
  ping: number;
}

export interface KillFeedEntryData {
  killer: string;
  killerTeam: 'Vanguard' | 'Syndicate';
  victim: string;
  victimTeam: 'Vanguard' | 'Syndicate';
  weaponId: string;
  isHeadshot?: boolean;
  isWallbang?: boolean;
  isLocalInvolved?: boolean;
}

/**
 * Computes attacker bearing relative to the local player's forward view axis.
 * Returns radians where 0 = straight ahead, +PI/2 = right, -PI/2 = left, +/-PI = behind.
 */
export function computeRelativeAttackerAngleRad(
  playerPos: { x: number; z: number },
  playerYaw: number,
  attackerPos: { x: number; z: number }
): number {
  const dx = attackerPos.x - playerPos.x;
  const dz = attackerPos.z - playerPos.z;
  const fwdDot = dx * -Math.sin(playerYaw) + dz * -Math.cos(playerYaw);
  const rightDot = dx * Math.cos(playerYaw) + dz * -Math.sin(playerYaw);
  return Math.atan2(rightDot, fwdDot);
}

const HEADSHOT_SKULL_SVG =
  '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
  '<circle cx="9" cy="9" r="6.8" stroke-opacity="0.72"/>' +
  '<line x1="9" y1="0.8" x2="9" y2="3.4"/><line x1="9" y1="14.6" x2="9" y2="17.2"/>' +
  '<line x1="0.8" y1="9" x2="3.4" y2="9"/><line x1="14.6" y1="9" x2="17.2" y2="9"/>' +
  '<path d="M6.4 8.5a2.6 2.6 0 1 1 5.2 0c0 1.2-.6 2-1.1 2.5v1.3h-3V11c-.5-.5-1.1-1.3-1.1-2.5Z" fill="currentColor" stroke="none"/>' +
  '<circle cx="7.9" cy="8.4" r="0.65" fill="#180a0d" stroke="none"/><circle cx="10.1" cy="8.4" r="0.65" fill="#180a0d" stroke="none"/>' +
  '</svg>';

const BODY_KILL_CARD_SVG =
  '<svg viewBox="0 0 14 14" width="10" height="10" fill="currentColor" aria-hidden="true">' +
  '<polygon points="7,1.4 12.2,7 7,12.6 1.8,7"/>' +
  '</svg>';

const WALLBANG_SVG =
  '<svg viewBox="0 0 18 14" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<rect x="7.5" y="1.5" width="3" height="11" rx="0.5" fill="currentColor" fill-opacity="0.3"/>' +
  '<line x1="1" y1="7" x2="15" y2="7"/><polyline points="12,4 15.8,7 12,10"/>' +
  '</svg>';

const C4_TIMER_SVG =
  '<svg class="c4-timer-icon" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
  '<rect x="2.5" y="4" width="13" height="10" rx="1.6" fill="currentColor" fill-opacity="0.22"/>' +
  '<rect x="5" y="6.2" width="8" height="3.2" rx="0.5" fill="currentColor"/>' +
  '<circle cx="9" cy="11.6" r="1.1" fill="#fff" stroke="none"/>' +
  '<path d="M5.5 4V2.4M12.5 4V2.4" stroke-linecap="round"/>' +
  '</svg>';

function getWeaponSilhouetteSvg(weaponId: string): string {
  switch (weaponId) {
    case 'garam-47':
      return '<svg viewBox="0 0 42 14" width="34" height="12" fill="currentColor" aria-hidden="true"><path d="M1 8.5h8l2-2h11l1.5 1.2h12.5v1.3H27.5l-1 1.4h-2.2l.8 2.8h-2.3l-1.3-3.2h-5.8l-.8 2.6h-2.1l.4-2.6H9.8L3.5 12H1V8.5zm14.5-3.2h5.2v1h-5.2v-1z"/></svg>';
    case 'vanguard-m4':
      return '<svg viewBox="0 0 46 14" width="36" height="12" fill="currentColor" aria-hidden="true"><path d="M1 7.6h7.2l1.6-1.4h11.5v1h6.8v-.4h15.5v2H28.1v-.4H23l-.8 3.6h-2.1l.5-3.2h-4.6l-.8 2.8H13l.5-2.8H9.2L3.5 11.4H1V7.6zm10.8-2.4h6.4v1h-6.4v-1z"/></svg>';
    case 'm4a4':
      return '<svg viewBox="0 0 42 14" width="34" height="12" fill="currentColor" aria-hidden="true"><path d="M1 7.6h7.4l1.6-1.5h12.2v1h14.4v1.6H24.6l-.8 3.6h-2.2l.5-3.2h-4.6l-.8 2.7h-2.2l.5-2.7H9.4L3.6 11.4H1V7.6zm11.2-2.4h6.2v1h-6.2v-1z"/></svg>';
    case 'mp9':
      return '<svg viewBox="0 0 32 14" width="26" height="12" fill="currentColor" aria-hidden="true"><path d="M2 6.8h5.2V5.4h13.5v1.4h8.2v1.6h-8.2v1.2h-2.4l.7 3.6h-2.2l-.9-3.6h-4.4l-.8 2.8H8.6l.5-2.8H2V6.8z"/></svg>';
    case 'sovereign-awp':
      return '<svg viewBox="0 0 48 14" width="38" height="12" fill="currentColor" aria-hidden="true"><path d="M1 8.2h8.8l2-1.8h12.4v.8h22v1.4H24.6l-1.2 1.6h-6.2l-.9 2.4h-2.3l.6-2.4H10.2L4.2 12H1V8.2zm12.4-4.2h9.4v1.7h-9.4V4z"/></svg>';
    case 'desert-eagle':
      return '<svg viewBox="0 0 28 14" width="22" height="12" fill="currentColor" aria-hidden="true"><path d="M4 4.2h19.5v2.6H16l-1.2 1.2H11l-1.6 4.6H6.2l1.6-5.2H4V4.2z"/></svg>';
    case 'usp-s':
      return '<svg viewBox="0 0 32 14" width="26" height="12" fill="currentColor" aria-hidden="true"><path d="M3 4.6h13.2v.6h13.2v1.8H16.2v.8h-4.6L10 12.2H7.2l1.4-4.8H3V4.6z"/></svg>';
    case 'glock-18':
      return '<svg viewBox="0 0 26 14" width="20" height="12" fill="currentColor" aria-hidden="true"><path d="M4.5 4.4h16.5v2.4h-8.4L11 12H8l1.4-5.2H4.5V4.4z"/></svg>';
    case 'garam-karambit':
      return '<svg viewBox="0 0 28 14" width="22" height="12" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="6.2" cy="8.5" r="2.2"/><path d="M8.4 7.8c3.2-2.8 8.4-4.6 15.2-3.4-3.8 2.4-7.4 3.6-11.2 4.1" fill="currentColor"/></svg>';
    case 'mp5-navy':
      return '<svg viewBox="0 0 36 14" width="28" height="12" fill="currentColor" aria-hidden="true"><path d="M2 7h6V5.5h15.5V7H32v1.6h-8.5v1h-2.3l1.1 3.5H20l-1.3-3.5h-4.8l-.8 2.6h-2l.5-2.6H2V7z"/></svg>';
    case 'clarion-famas':
      return '<svg viewBox="0 0 42 14" width="34" height="12" fill="currentColor" aria-hidden="true"><path d="M2 7.4h11V4.4h14v3h12v1.5H28.5l-.5 2.2h-4.5l-.6 1.8h-2.4l.4-2.8H13l-.7 2.8H9.8l.4-2.8H2V7.4zm13.2-1.8v1.8h9.6V5.6h-9.6z"/></svg>';
    case 'defender-galil':
      return '<svg viewBox="0 0 44 14" width="34" height="12" fill="currentColor" aria-hidden="true"><path d="M1 8.2h8.2l1.8-1.9h12.2v1.2h16v1.4H26l-.8 1.5h-2l.9 2.7h-2.3l-1.2-3.1h-5.6l-.8 2.6H12l.4-2.6H9.4L3.2 11.8H1V8.2z"/></svg>';
    case 'schmidt-scout':
      return '<svg viewBox="0 0 48 14" width="38" height="12" fill="currentColor" aria-hidden="true"><path d="M1 8.4h9.5l2-1.6h13v.7h20v1.2H25.5l-1.5 1.4h-7.8l-.6 1.8h-2.2l.4-1.8H10L4 11.8H1V8.4zm14.5-3.8h7.5v1.4h-7.5V4.6z"/></svg>';
    case 'p90':
      return '<svg viewBox="0 0 34 14" width="28" height="12" fill="currentColor" aria-hidden="true"><path d="M3 5.8h22.5v1.2H31v1.8h-6.5l-1.6 3.2h-4.6l.8-2.4h-5.4l-.9 2.4H8.5l1.2-2.4H3V5.8zm4-1.4h16.2v1H7v-1z"/></svg>';
    case 'leone-m3':
      return '<svg viewBox="0 0 44 14" width="35" height="12" fill="currentColor" aria-hidden="true"><path d="M1 8.6h8.8l2-1.8h28.8v1.3H28.8v1.2h-9.2l-1.2 1h-6.2L4.2 12H1V8.6z"/></svg>';
    case 'xm1014':
      return '<svg viewBox="0 0 44 14" width="35" height="12" fill="currentColor" aria-hidden="true"><path d="M1 8h8.5l1.8-1.6h29.2v1.5H27.4v1.1h-9l-1 1.1h-2.8l-.8 2.2h-2.2l.6-2.4H9.2L3.5 11.6H1V8z"/></svg>';
    case 'dual-elites':
      return '<svg viewBox="0 0 32 14" width="26" height="12" fill="currentColor" aria-hidden="true"><path d="M2 3.2h12v2H8.4L7.2 9.4H4.8l1.1-4.2H2v-2zm15 2.4h12v2h-5.6l-1.2 4.2h-2.4l1.1-4.2H17v-2z"/></svg>';
    case 'tactical-shield':
      return '<svg viewBox="0 0 24 14" width="20" height="12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6" y="1.4" width="12" height="11.2" rx="1.6" fill="currentColor" fill-opacity="0.25"/><rect x="8.2" y="3.4" width="7.6" height="2.4" rx="0.5" fill="currentColor"/></svg>';
    default:
      return '<svg viewBox="0 0 34 14" width="28" height="12" fill="currentColor" aria-hidden="true"><path d="M2 7h28v2H19l-1 3h-2l.6-3H9L4 11H2V7z"/></svg>';
  }
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

export class HUDManager {
  // Cached static DOM elements
  private hpEl = document.getElementById('hud-hp');
  private hpFillEl = document.getElementById('hud-hp-fill');
  private armorEl = document.getElementById('hud-armor');
  private armorFillEl = document.getElementById('hud-armor-fill');
  private speedEl = document.getElementById('hud-speed');
  private cashEl = document.getElementById('hud-cash');
  private weaponNameEl = document.getElementById('hud-weapon-name');
  private ammoCurEl = document.getElementById('hud-ammo-cur');
  private ammoResEl = document.getElementById('hud-ammo-res');
  private reloadIndicator = document.getElementById('reload-indicator');
  private reloadFill = document.getElementById('reload-fill');
  private scoreCtEl = document.getElementById('score-ct');
  private scoreTEl = document.getElementById('score-t');
  private aliveCtEl = document.getElementById('alive-ct');
  private aliveTEl = document.getElementById('alive-t');
  private roundTimerEl = document.getElementById('round-timer');
  private killfeedEl = document.getElementById('killfeed');
  private radioFeedEl = document.getElementById('cs2-radio-feed');
  private sniperScopeEl = document.getElementById('sniper-scope');
  private nvgOverlayEl = document.getElementById('nvg-overlay');
  private calloutEl = document.getElementById('hud-callout');
  private scoreboardTbody = document.getElementById('score-tbody');
  private killCardsEl = document.getElementById('cs2-kill-cards');
  private killFlareEl = document.getElementById('cs2-kill-flare');
  private factionEmblemEl = document.getElementById('cs2-faction-emblem');
  private tacticalToastEl = document.getElementById('cs2-tactical-toast');
  private slotEls: (HTMLElement | null)[] = [
    null,
    document.getElementById('slot-1'),
    document.getElementById('slot-2'),
    document.getElementById('slot-3'),
    document.getElementById('slot-4'),
    document.getElementById('slot-5'),
  ];

  // Crosshair
  private crosshairEl = document.getElementById('crosshair');
  private chTop = document.getElementById('ch-top');
  private chBottom = document.getElementById('ch-bottom');
  private chLeft = document.getElementById('ch-left');
  private chRight = document.getElementById('ch-right');
  private crosshairBars: HTMLElement[] = Array.from(
    document.querySelectorAll('.crosshair-bar, .crosshair-dot')
  ) as HTMLElement[];

  // Lazily created overlay nodes
  private interactionContainer: HTMLElement | null = null;
  private interactionFill: HTMLElement | null = null;
  private interactionLabel: HTMLElement | null = null;
  private hitmarkerEl: HTMLElement | null = null;
  private damageIndicatorEl: HTMLElement | null = null;

  // Dirty-check caches to prevent redundant 60Hz DOM mutations
  private lastCallout = '';
  private lastHp = -1;
  private lastArmor = -1;
  private lastCash = -1;
  private lastWeaponName = '';
  private lastAmmoCur = -1;
  private lastAmmoRes = -1;
  private lastSpeedText = '';
  private lastPinpoint: boolean | null = null;
  private lastActiveSlot = -1;
  private lastReloadVisible = false;
  private lastReloadPct = -1;
  private lastCrosshairGap = -1;
  private lastCrosshairColor = '';
  private lastCrosshairTransform = '';
  private lastScopeVisible: boolean | null = null;
  private lastTimerText = '';
  private lastTimerColor = '';
  private wasBombArmed = false;
  private lastCtScore = -1;
  private lastTScore = -1;
  private lastCtAlive = -1;
  private lastTAlive = -1;
  private lastInteractionVisible = false;
  private lastInteractionPct = -1;
  private lastInteractionLabel = '';
  public roundKillCount = 0;
  private toastTimeout: number | null = null;
  private flareTimeout: number | null = null;
  private damageArcTimeout: number | null = null;

  constructor() {}

  public updateCallout(zoneName: string): void {
    const upper = zoneName.toUpperCase();
    if (upper === this.lastCallout) return;
    this.lastCallout = upper;

    if (!this.calloutEl) {
      this.calloutEl = document.getElementById('hud-callout');
    }
    if (this.calloutEl) {
      this.calloutEl.textContent = upper;
    }
  }

  public updatePlayerStats(
    hp: number,
    armor: number,
    cash: number,
    speed: number,
    isPinpoint: boolean,
    weaponName: string,
    currentAmmo: number,
    reserveAmmo: number,
    activeSlot: number
  ): void {
    const roundedHp = Math.round(hp);
    const roundedArmor = Math.round(armor);
    const roundedCash = Math.round(cash);

    if (roundedHp !== this.lastHp) {
      this.lastHp = roundedHp;
      const clampedHp = Math.max(0, Math.min(100, roundedHp));
      const isLowHp = clampedHp <= 25;
      if (this.hpEl) {
        this.hpEl.textContent = roundedHp.toString();
        this.hpEl.style.color = isLowHp ? '#ff3b4a' : '#f8fafc';
      }
      if (this.hpFillEl) {
        this.hpFillEl.style.width = `${clampedHp}%`;
        this.hpFillEl.style.background = isLowHp ? '#ff3b4a' : '#f1f5f9';
      }
    }
    if (roundedArmor !== this.lastArmor) {
      this.lastArmor = roundedArmor;
      const clampedArmor = Math.max(0, Math.min(100, roundedArmor));
      if (this.armorEl) this.armorEl.textContent = roundedArmor.toString();
      if (this.armorFillEl) this.armorFillEl.style.width = `${clampedArmor}%`;
    }
    if (roundedCash !== this.lastCash) {
      this.lastCash = roundedCash;
      if (this.cashEl) this.cashEl.textContent = `$${roundedCash}`;
    }

    const upperWeapon = weaponName.toUpperCase();
    if (upperWeapon !== this.lastWeaponName) {
      this.lastWeaponName = upperWeapon;
      if (this.weaponNameEl) this.weaponNameEl.textContent = upperWeapon;
    }
    if (currentAmmo !== this.lastAmmoCur) {
      this.lastAmmoCur = currentAmmo;
      if (this.ammoCurEl) this.ammoCurEl.textContent = currentAmmo.toString();
    }
    if (reserveAmmo !== this.lastAmmoRes) {
      this.lastAmmoRes = reserveAmmo;
      if (this.ammoResEl) this.ammoResEl.textContent = reserveAmmo.toString();
    }

    const speedText = `${speed.toFixed(1)} m/s ${isPinpoint ? '• PINPOINT' : ''}`;
    if (speedText !== this.lastSpeedText) {
      this.lastSpeedText = speedText;
      if (this.speedEl) this.speedEl.textContent = speedText;
    }
    if (isPinpoint !== this.lastPinpoint) {
      this.lastPinpoint = isPinpoint;
      if (this.speedEl) this.speedEl.style.color = isPinpoint ? '#00ff88' : '#ffaa33';
    }

    if (activeSlot !== this.lastActiveSlot) {
      this.lastActiveSlot = activeSlot;
      for (let i = 1; i <= 5; i++) {
        const el = this.slotEls[i];
        if (el) {
          el.classList.toggle('active', i === activeSlot);
        }
      }
    }
  }

  public updateReloadProgress(isReloading: boolean, progress: number): void {
    if (!this.reloadIndicator || !this.reloadFill) return;
    if (isReloading) {
      if (!this.lastReloadVisible) {
        this.lastReloadVisible = true;
        this.reloadIndicator.style.display = 'block';
      }
      const pct = Math.round(progress * 100);
      if (pct !== this.lastReloadPct) {
        this.lastReloadPct = pct;
        this.reloadFill.style.width = `${pct}%`;
      }
    } else if (this.lastReloadVisible) {
      this.lastReloadVisible = false;
      this.lastReloadPct = 0;
      this.reloadIndicator.style.display = 'none';
      this.reloadFill.style.width = '0%';
    }
  }

  public updateCrosshair(
    speed: number,
    consecutiveShots: number,
    isPinpoint: boolean,
    aimPunchYaw = 0,
    aimPunchPitch = 0,
    followRecoil = false
  ): void {
    const spreadGap = (speed / 5.45) * 16 + consecutiveShots * 1.6;
    const totalGap = Math.round((4 + spreadGap) * 2) / 2;

    if (totalGap !== this.lastCrosshairGap) {
      this.lastCrosshairGap = totalGap;
      if (this.chTop) this.chTop.style.top = `${-totalGap - 8}px`;
      if (this.chBottom) this.chBottom.style.top = `${totalGap}px`;
      if (this.chLeft) this.chLeft.style.left = `${-totalGap - 8}px`;
      if (this.chRight) this.chRight.style.left = `${totalGap}px`;
    }

    const color = isPinpoint ? '#00ff88' : '#ff334b';
    if (color !== this.lastCrosshairColor) {
      this.lastCrosshairColor = color;
      for (let i = 0; i < this.crosshairBars.length; i++) {
        this.crosshairBars[i].style.background = color;
      }
    }

    if (this.crosshairEl) {
      let transform = 'translate(-50%, -50%)';
      if (followRecoil && (Math.abs(aimPunchYaw) > 0.001 || Math.abs(aimPunchPitch) > 0.001)) {
        const halfH = window.innerHeight / 2;
        const fovRad = (90 * Math.PI) / 180;
        const focalLength = halfH / Math.tan(fovRad / 2);
        const followX = Math.tan(aimPunchYaw) * focalLength;
        const followY = -Math.tan(aimPunchPitch) * focalLength;
        transform = `translate(calc(-50% + ${followX.toFixed(1)}px), calc(-50% + ${followY.toFixed(1)}px))`;
      }
      if (transform !== this.lastCrosshairTransform) {
        this.lastCrosshairTransform = transform;
        this.crosshairEl.style.transform = transform;
      }
    }
  }

  public setScopeOverlay(visible: boolean): void {
    if (visible === this.lastScopeVisible) return;
    this.lastScopeVisible = visible;
    if (this.sniperScopeEl) {
      this.sniperScopeEl.style.display = visible ? 'block' : 'none';
    }
  }

  public setNightVision(active: boolean): void {
    if (!this.nvgOverlayEl) {
      this.nvgOverlayEl = document.getElementById('nvg-overlay');
    }
    if (this.nvgOverlayEl) {
      this.nvgOverlayEl.style.display = active ? 'block' : 'none';
    }
  }

  public updateRoundTimer(secondsRemaining: number, isBombArmed: boolean): void {
    if (isBombArmed && !this.wasBombArmed) {
      this.showTacticalToast('The bomb has been planted — 40 seconds till detonation', 3000);
    }
    this.wasBombArmed = isBombArmed;

    if (!this.roundTimerEl) this.roundTimerEl = document.getElementById('round-timer');
    if (!this.roundTimerEl) return;
    const clamped = Math.max(0, Math.floor(secondsRemaining));
    let key: string;
    let color: string;
    if (isBombArmed) {
      key = `C4:00:${clamped.toString().padStart(2, '0')}`;
      color = '#ff3b4a';
    } else {
      const mins = Math.floor(clamped / 60);
      const secs = clamped % 60;
      key = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      color = '#f8fafc';
    }

    if (key !== this.lastTimerText) {
      this.lastTimerText = key;
      if (isBombArmed) {
        this.roundTimerEl.innerHTML = `${C4_TIMER_SVG}<span>00:${clamped.toString().padStart(2, '0')}</span>`;
      } else {
        this.roundTimerEl.textContent = key;
      }
    }
    if (color !== this.lastTimerColor) {
      this.lastTimerColor = color;
      this.roundTimerEl.style.color = color;
    }
  }

  public updateScores(ctScore: number, tScore: number): void {
    if (ctScore !== this.lastCtScore) {
      this.lastCtScore = ctScore;
      if (this.scoreCtEl) this.scoreCtEl.textContent = ctScore.toString();
    }
    if (tScore !== this.lastTScore) {
      this.lastTScore = tScore;
      if (this.scoreTEl) this.scoreTEl.textContent = tScore.toString();
    }
  }

  public updateAliveCounts(ctAlive: number, tAlive: number): void {
    if (ctAlive !== this.lastCtAlive) {
      this.lastCtAlive = ctAlive;
      if (!this.aliveCtEl) this.aliveCtEl = document.getElementById('alive-ct');
      if (this.aliveCtEl) this.aliveCtEl.textContent = ctAlive.toString();
    }
    if (tAlive !== this.lastTAlive) {
      this.lastTAlive = tAlive;
      if (!this.aliveTEl) this.aliveTEl = document.getElementById('alive-t');
      if (this.aliveTEl) this.aliveTEl.textContent = tAlive.toString();
    }
  }

  public setFactionTheme(faction: 'Vanguard' | 'Syndicate'): void {
    if (!this.factionEmblemEl) this.factionEmblemEl = document.getElementById('cs2-faction-emblem');
    if (this.factionEmblemEl) {
      this.factionEmblemEl.dataset.faction = faction.toLowerCase();
      this.factionEmblemEl.style.borderColor =
        faction === 'Syndicate' ? 'rgba(232, 184, 90, 0.72)' : 'rgba(104, 168, 232, 0.72)';
      this.factionEmblemEl.style.color = faction === 'Syndicate' ? '#e8b85a' : '#68a8e8';
    }
  }

  public recordRoundKill(isHeadshot: boolean): void {
    this.roundKillCount = Math.min(5, this.roundKillCount + 1);
    if (!this.killCardsEl) this.killCardsEl = document.getElementById('cs2-kill-cards');
    if (this.killCardsEl) {
      const card = document.createElement('div');
      card.className = `cs2-kill-card${isHeadshot ? ' headshot' : ''}`;
      card.innerHTML = isHeadshot ? HEADSHOT_SKULL_SVG : BODY_KILL_CARD_SVG;
      this.killCardsEl.appendChild(card);
    }

    if (!this.killFlareEl) this.killFlareEl = document.getElementById('cs2-kill-flare');
    if (this.killFlareEl) {
      this.killFlareEl.style.background = isHeadshot
        ? 'linear-gradient(180deg, rgba(255, 224, 130, 0) 0%, rgba(255, 198, 92, 0.84) 48%, rgba(255, 250, 225, 0.98) 100%)'
        : 'linear-gradient(180deg, rgba(186, 230, 253, 0) 0%, rgba(125, 211, 252, 0.72) 52%, rgba(248, 250, 252, 0.96) 100%)';
      this.killFlareEl.classList.remove('active');
      void this.killFlareEl.offsetWidth;
      this.killFlareEl.classList.add('active');
      if (this.flareTimeout !== null) window.clearTimeout(this.flareTimeout);
      this.flareTimeout = window.setTimeout(() => {
        this.killFlareEl?.classList.remove('active');
      }, 340);
    }
  }

  public resetRoundKills(): void {
    this.roundKillCount = 0;
    this.wasBombArmed = false;
    if (!this.killCardsEl) this.killCardsEl = document.getElementById('cs2-kill-cards');
    if (this.killCardsEl) {
      this.killCardsEl.innerHTML = '';
    }
    this.killFlareEl?.classList.remove('active');
  }

  public showTacticalToast(message: string, durationMs = 3000): void {
    if (!this.tacticalToastEl) this.tacticalToastEl = document.getElementById('cs2-tactical-toast');
    if (!this.tacticalToastEl) return;
    this.tacticalToastEl.textContent = message;
    this.tacticalToastEl.style.display = 'block';
    this.tacticalToastEl.style.opacity = '1';
    if (this.toastTimeout !== null) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      if (this.tacticalToastEl) {
        this.tacticalToastEl.style.opacity = '0';
        window.setTimeout(() => {
          if (this.tacticalToastEl && this.tacticalToastEl.style.opacity === '0') {
            this.tacticalToastEl.style.display = 'none';
          }
        }, 220);
      }
    }, durationMs);
  }

  public addRadioMessage(text: string): void {
    if (!this.radioFeedEl) this.radioFeedEl = document.getElementById('cs2-radio-feed');
    if (!this.radioFeedEl) return;
    while (this.radioFeedEl.children.length >= 3) {
      this.radioFeedEl.firstElementChild?.remove();
    }
    const line = document.createElement('div');
    line.className = 'radio-feed-line';
    line.textContent = text;
    this.radioFeedEl.appendChild(line);
    setTimeout(() => line.remove(), 3500);
  }

  public addKillEntry(data: KillFeedEntryData): void {
    if (!this.killfeedEl) this.killfeedEl = document.getElementById('killfeed');
    if (!this.killfeedEl) return;
    while (this.killfeedEl.children.length >= 5) {
      this.killfeedEl.firstElementChild?.remove();
    }

    const entry = document.createElement('div');
    entry.className = data.isLocalInvolved ? 'kill-entry local-kill' : 'kill-entry';
    const killerClass = data.killerTeam === 'Vanguard' ? 'ct' : 't';
    const victimClass = data.victimTeam === 'Vanguard' ? 'ct' : 't';
    const weaponSvg = getWeaponSilhouetteSvg(data.weaponId);
    const wbHtml = data.isWallbang ? `<span class="kill-wb-icon">${WALLBANG_SVG}</span>` : '';
    const hsHtml = data.isHeadshot ? `<span class="kill-hs-icon">${HEADSHOT_SKULL_SVG}</span>` : '';

    entry.innerHTML =
      `<span class="kill-name ${killerClass}">${escapeHtml(data.killer)}</span>` +
      `<span class="kill-weapon-icon">${weaponSvg}</span>` +
      wbHtml +
      hsHtml +
      `<span class="kill-name ${victimClass}">${escapeHtml(data.victim)}</span>`;

    this.killfeedEl.appendChild(entry);
    setTimeout(() => entry.remove(), 5000);
  }

  public addKillfeed(text: string, isLocalKill = false): void {
    if (!this.killfeedEl) this.killfeedEl = document.getElementById('killfeed');
    if (!this.killfeedEl) return;
    while (this.killfeedEl.children.length >= 5) {
      this.killfeedEl.firstElementChild?.remove();
    }
    const entry = document.createElement('div');
    entry.className = isLocalKill ? 'kill-entry local-kill' : 'kill-entry';
    entry.textContent = text;
    this.killfeedEl.appendChild(entry);
    setTimeout(() => entry.remove(), 5000);
  }

  public showRoundWinRibbon(
    winner: 'Vanguard' | 'Syndicate',
    reason: string,
    mvpName?: string,
    durationMs = 4500
  ): void {
    const existing = document.getElementById('round-banner');
    if (existing) existing.remove();

    const accent = winner === 'Vanguard' ? '#68a8e8' : '#e8b85a';
    const label = winner === 'Vanguard' ? 'VANGUARD WINS' : 'SYNDICATE WINS';

    const ribbon = document.createElement('div');
    ribbon.id = 'round-banner';
    ribbon.className = 'cs2-round-ribbon';
    ribbon.style.setProperty('--ribbon-accent', accent);
    ribbon.innerHTML =
      `<div class="cs2-round-ribbon-title">${escapeHtml(label)}</div>` +
      `<div class="cs2-round-ribbon-sub">${escapeHtml(reason)}</div>` +
      (mvpName ? `<div class="cs2-round-ribbon-mvp">MVP &bull; ${escapeHtml(mvpName)}</div>` : '');

    const overlay = document.getElementById('ui-overlay');
    if (overlay) {
      overlay.appendChild(ribbon);
    } else {
      document.body.appendChild(ribbon);
    }

    setTimeout(() => ribbon.remove(), durationMs);
  }

  public showCenterBanner(title: string, subtitle: string, durationMs = 3500): void {
    const existing = document.getElementById('round-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'round-banner';
    banner.style.position = 'absolute';
    banner.style.top = '32%';
    banner.style.left = '50%';
    banner.style.transform = 'translate(-50%, -50%)';
    banner.style.textAlign = 'center';
    banner.style.pointerEvents = 'none';
    banner.style.zIndex = '45';

    const tEl = document.createElement('div');
    tEl.style.fontSize = '44px';
    tEl.style.fontWeight = '900';
    tEl.style.letterSpacing = '6px';
    tEl.style.textTransform = 'uppercase';
    tEl.style.color = title.includes('VANGUARD') ? '#3b9eff' : title.includes('SYNDICATE') ? '#ffaa00' : '#fff';
    tEl.style.textShadow = '0 0 20px rgba(0,0,0,0.9)';
    tEl.textContent = title;

    const sEl = document.createElement('div');
    sEl.style.fontSize = '16px';
    sEl.style.letterSpacing = '3px';
    sEl.style.color = '#c4c9ce';
    sEl.style.marginTop = '8px';
    sEl.textContent = subtitle;

    banner.appendChild(tEl);
    banner.appendChild(sEl);

    const overlay = document.getElementById('ui-overlay');
    if (overlay) {
      overlay.appendChild(banner);
    } else {
      document.body.appendChild(banner);
    }

    setTimeout(() => banner.remove(), durationMs);
  }

  public triggerFlashEffect(durationSec: number): void {
    const whiteout = document.createElement('div');
    whiteout.style.position = 'fixed';
    whiteout.style.inset = '0';
    whiteout.style.background = '#ffffff';
    whiteout.style.pointerEvents = 'none';
    whiteout.style.zIndex = '95';
    whiteout.style.transition = `opacity ${durationSec.toFixed(2)}s ease-out`;
    document.body.appendChild(whiteout);
    requestAnimationFrame(() => {
      whiteout.style.opacity = '0';
      setTimeout(() => whiteout.remove(), durationSec * 1000);
    });
  }

  public updateInteractionBar(progressRatio: number, label: string): void {
    if (!this.interactionContainer) {
      this.interactionContainer = document.getElementById('interaction-progress-container');
      if (!this.interactionContainer) {
        const container = document.createElement('div');
        container.id = 'interaction-progress-container';
        container.style.position = 'absolute';
        container.style.bottom = '180px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.width = '300px';
        container.style.textAlign = 'center';
        container.style.pointerEvents = 'none';
        container.style.zIndex = '70';
        container.style.display = 'none';

        container.innerHTML = `
          <div id="interaction-label" style="font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #fff; margin-bottom: 6px;"></div>
          <div style="width: 100%; height: 8px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; overflow: hidden;">
            <div id="interaction-fill" style="width: 0%; height: 100%; background: #00ff88; transition: width 0.05s linear;"></div>
          </div>
        `;
        document.body.appendChild(container);
        this.interactionContainer = container;
      }
      this.interactionFill = document.getElementById('interaction-fill');
      this.interactionLabel = document.getElementById('interaction-label');
    }

    if (progressRatio > 0) {
      if (!this.lastInteractionVisible) {
        this.lastInteractionVisible = true;
        this.interactionContainer.style.display = 'block';
      }
      const pct = Math.min(100, Math.round(progressRatio * 100));
      if (pct !== this.lastInteractionPct) {
        this.lastInteractionPct = pct;
        if (this.interactionFill) this.interactionFill.style.width = `${pct}%`;
      }
      if (label !== this.lastInteractionLabel) {
        this.lastInteractionLabel = label;
        if (this.interactionLabel) this.interactionLabel.textContent = label;
      }
    } else if (this.lastInteractionVisible) {
      this.lastInteractionVisible = false;
      this.lastInteractionPct = 0;
      this.interactionContainer.style.display = 'none';
    }
  }

  public updateScoreboard(
    playerKills: number,
    playerDeaths: number,
    playerCash: number,
    bots: BotEntity[],
    playerAlive = true,
    playerPing = 12
  ): void {
    const localTeam = settingsStore.settings.faction;
    const localCallsign = settingsStore.settings.callsign || 'Operator';
    const localPlayerRow: ScoreboardPlayer = {
      id: 'player',
      name: `★ ${localCallsign} (You)`,
      team: localTeam,
      kills: playerKills,
      deaths: playerDeaths,
      assists: 0,
      adr: 105,
      cash: playerCash,
      isAlive: playerAlive,
      ping: Math.max(0, Math.round(playerPing)),
    };

    const vgBots: ScoreboardPlayer[] = bots
      .filter((b) => b.team === 'Vanguard')
      .map((b) => ({
        id: b.id,
        name: b.name,
        team: 'Vanguard' as const,
        kills: b.kills,
        deaths: b.deaths,
        assists: 0,
        adr: 85,
        cash: 3200,
        isAlive: !b.isDead,
        ping: 16,
      }));

    const synBots: ScoreboardPlayer[] = bots
      .filter((b) => b.team === 'Syndicate')
      .map((b) => ({
        id: b.id,
        name: b.name,
        team: 'Syndicate' as const,
        kills: b.kills,
        deaths: b.deaths,
        assists: 0,
        adr: 80,
        cash: 2800,
        isAlive: !b.isDead,
        ping: 22,
      }));

    const vg = localTeam === 'Vanguard' ? [localPlayerRow, ...vgBots] : vgBots;
    const syn = localTeam === 'Syndicate' ? [localPlayerRow, ...synBots] : synBots;

    this.renderDynamicScoreboard(vg, syn);
  }

  public renderDynamicScoreboard(
    vanguardTeam: ScoreboardPlayer[],
    syndicateTeam: ScoreboardPlayer[]
  ): void {
    const tbody = this.scoreboardTbody ?? document.getElementById('score-tbody');
    if (!tbody) return;
    this.scoreboardTbody = tbody;

    let html = '';
    for (const p of vanguardTeam) {
      html += `
        <tr style="color: ${p.isAlive ? '#fff' : '#6b7280'};">
          <td style="color: #3b9eff; font-weight: 700;">${escapeHtml(p.name)}</td>
          <td>Garam Vanguard</td>
          <td>${p.kills}</td>
          <td>${p.deaths}</td>
          <td style="color: #00ff88;">${p.ping}ms</td>
        </tr>
      `;
    }
    for (const p of syndicateTeam) {
      html += `
        <tr style="color: ${p.isAlive ? '#fff' : '#6b7280'};">
          <td style="color: #ffaa00; font-weight: 700;">${escapeHtml(p.name)}</td>
          <td>Obsidian Syndicate</td>
          <td>${p.kills}</td>
          <td>${p.deaths}</td>
          <td style="color: #00ff88;">${p.ping}ms</td>
        </tr>
      `;
    }
    tbody.innerHTML = html;
  }

  public triggerHitmarker(isHeadshot: boolean): void {
    if (!this.hitmarkerEl) {
      let hm = document.getElementById('crosshair-hitmarker');
      if (!hm) {
        hm = document.createElement('div');
        hm.id = 'crosshair-hitmarker';
        hm.style.position = 'absolute';
        hm.style.top = '50%';
        hm.style.left = '50%';
        hm.style.width = '24px';
        hm.style.height = '24px';
        hm.style.transform = 'translate(-50%, -50%) rotate(45deg)';
        hm.style.pointerEvents = 'none';
        hm.style.zIndex = '55';
        hm.innerHTML = `
          <div style="position: absolute; top: 0; left: 11px; width: 2px; height: 8px; background: currentColor;"></div>
          <div style="position: absolute; bottom: 0; left: 11px; width: 2px; height: 8px; background: currentColor;"></div>
          <div style="position: absolute; left: 0; top: 11px; width: 8px; height: 2px; background: currentColor;"></div>
          <div style="position: absolute; right: 0; top: 11px; width: 8px; height: 2px; background: currentColor;"></div>
        `;
        document.body.appendChild(hm);
      }
      this.hitmarkerEl = hm;
    }

    const hm = this.hitmarkerEl;
    hm.style.color = isHeadshot ? '#ff2a44' : '#ffffff';
    hm.style.display = 'block';
    hm.style.opacity = '1';
    hm.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(1.3)';
    hm.style.transition = 'transform 0.12s ease-out, opacity 0.15s ease-out';

    setTimeout(() => {
      hm.style.transform = 'translate(-50%, -50%) rotate(45deg) scale(0.9)';
      hm.style.opacity = '0';
    }, 120);
  }

  public triggerDamageIndicator(angleRad: number): void {
    if (!this.damageIndicatorEl) {
      let ind = document.getElementById('damage-indicator-arc');
      if (!ind) {
        ind = document.createElement('div');
        ind.id = 'damage-indicator-arc';
        ind.style.position = 'absolute';
        ind.style.top = '50%';
        ind.style.left = '50%';
        ind.style.width = '320px';
        ind.style.height = '320px';
        ind.style.transform = 'translate(-50%, -50%)';
        ind.style.pointerEvents = 'none';
        ind.style.zIndex = '46';
        ind.innerHTML =
          '<svg viewBox="0 0 320 320" width="320" height="320" aria-hidden="true">' +
          '<defs><linearGradient id="cs2DmgArcGrad" x1="0" y1="0" x2="1" y2="0">' +
          '<stop offset="0%" stop-color="#ef2030" stop-opacity="0"/>' +
          '<stop offset="50%" stop-color="#ff2438" stop-opacity="0.96"/>' +
          '<stop offset="100%" stop-color="#ef2030" stop-opacity="0"/>' +
          '</linearGradient></defs>' +
          '<path d="M 96 38 A 138 138 0 0 1 224 38" fill="none" stroke="url(#cs2DmgArcGrad)" stroke-width="10" stroke-linecap="round"/>' +
          '<path d="M 114 48 A 126 126 0 0 1 206 48" fill="none" stroke="rgba(255, 170, 178, 0.72)" stroke-width="2.2" stroke-linecap="round"/>' +
          '</svg>';
        document.body.appendChild(ind);
      }
      this.damageIndicatorEl = ind;
    }

    const ind = this.damageIndicatorEl;
    const deg = (angleRad * 180) / Math.PI;
    ind.style.transform = `translate(-50%, -50%) rotate(${deg.toFixed(1)}deg)`;
    ind.style.opacity = '1';
    ind.style.transition = 'none';

    if (this.damageArcTimeout !== null) window.clearTimeout(this.damageArcTimeout);
    this.damageArcTimeout = window.setTimeout(() => {
      ind.style.transition = 'opacity 0.57s ease-out';
      ind.style.opacity = '0';
    }, 80);
  }
}

