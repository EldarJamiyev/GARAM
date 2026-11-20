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
  private armorEl = document.getElementById('hud-armor');
  private speedEl = document.getElementById('hud-speed');
  private cashEl = document.getElementById('hud-cash');
  private weaponNameEl = document.getElementById('hud-weapon-name');
  private ammoCurEl = document.getElementById('hud-ammo-cur');
  private ammoResEl = document.getElementById('hud-ammo-res');
  private reloadIndicator = document.getElementById('reload-indicator');
  private reloadFill = document.getElementById('reload-fill');
  private scoreCtEl = document.getElementById('score-ct');
  private scoreTEl = document.getElementById('score-t');
  private roundTimerEl = document.getElementById('round-timer');
  private killfeedEl = document.getElementById('killfeed');
  private sniperScopeEl = document.getElementById('sniper-scope');
  private calloutEl = document.getElementById('hud-callout');
  private scoreboardTbody = document.getElementById('score-tbody');
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
  private lastCtScore = -1;
  private lastTScore = -1;
  private lastInteractionVisible = false;
  private lastInteractionPct = -1;
  private lastInteractionLabel = '';

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
      if (this.hpEl) this.hpEl.textContent = roundedHp.toString();
    }
    if (roundedArmor !== this.lastArmor) {
      this.lastArmor = roundedArmor;
      if (this.armorEl) this.armorEl.textContent = roundedArmor.toString();
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

  public updateRoundTimer(secondsRemaining: number, isBombArmed: boolean): void {
    if (!this.roundTimerEl) return;
    const clamped = Math.max(0, Math.floor(secondsRemaining));
    let text: string;
    let color: string;
    if (isBombArmed) {
      text = `BOMB 00:${clamped.toString().padStart(2, '0')}`;
      color = '#ff2233';
    } else {
      const mins = Math.floor(clamped / 60);
      const secs = clamped % 60;
      text = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      color = '#fff';
    }

    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.roundTimerEl.textContent = text;
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

  public addKillfeed(text: string): void {
    if (!this.killfeedEl) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.textContent = text;
    this.killfeedEl.appendChild(entry);
    setTimeout(() => entry.remove(), 5000);
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
        ind.style.width = '280px';
        ind.style.height = '280px';
        ind.style.transform = 'translate(-50%, -50%)';
        ind.style.pointerEvents = 'none';
        ind.style.zIndex = '45';
        ind.style.borderRadius = '50%';
        ind.style.border = '5px solid transparent';
        ind.style.borderTopColor = 'rgba(255, 30, 50, 0.9)';
        ind.style.filter = 'drop-shadow(0 0 10px rgba(255, 30, 50, 0.8))';
        document.body.appendChild(ind);
      }
      this.damageIndicatorEl = ind;
    }

    const ind = this.damageIndicatorEl;
    const deg = (angleRad * 180) / Math.PI;
    ind.style.transform = `translate(-50%, -50%) rotate(${deg}deg)`;
    ind.style.opacity = '1';
    ind.style.transition = 'none';

    setTimeout(() => {
      ind.style.transition = 'opacity 0.4s ease-out';
      ind.style.opacity = '0';
    }, 80);
  }
}

