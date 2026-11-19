import { BotEntity } from '../maps/DeCitadelMap.js';

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

export class HUDManager {
  // Elements
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

  // Crosshair
  private chTop = document.getElementById('ch-top');
  private chBottom = document.getElementById('ch-bottom');
  private chLeft = document.getElementById('ch-left');
  private chRight = document.getElementById('ch-right');
  private crosshairBars = document.querySelectorAll('.crosshair-bar, .crosshair-dot');

  constructor() {}

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
    if (this.hpEl) this.hpEl.innerText = hp.toString();
    if (this.armorEl) this.armorEl.innerText = armor.toString();
    if (this.cashEl) this.cashEl.innerText = `$${cash}`;
    if (this.weaponNameEl) this.weaponNameEl.innerText = weaponName.toUpperCase();
    if (this.ammoCurEl) this.ammoCurEl.innerText = currentAmmo.toString();
    if (this.ammoResEl) this.ammoResEl.innerText = reserveAmmo.toString();

    if (this.speedEl) {
      this.speedEl.innerText = `${speed.toFixed(1)} m/s ${isPinpoint ? '• PINPOINT' : ''}`;
      this.speedEl.style.color = isPinpoint ? '#00ff88' : '#ffaa33';
    }

    // Active slot bar
    for (let i = 1; i <= 5; i++) {
      const el = document.getElementById(`slot-${i}`);
      if (el) {
        if (i === activeSlot) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    }
  }

  public updateReloadProgress(isReloading: boolean, progress: number): void {
    if (this.reloadIndicator && this.reloadFill) {
      if (isReloading) {
        this.reloadIndicator.style.display = 'block';
        this.reloadFill.style.width = `${Math.round(progress * 100)}%`;
      } else {
        this.reloadIndicator.style.display = 'none';
        this.reloadFill.style.width = '0%';
      }
    }
  }

  public updateCrosshair(speed: number, consecutiveShots: number, isPinpoint: boolean): void {
    const spreadGap = (speed / 5.45) * 16 + (consecutiveShots * 1.6);
    const totalGap = 4 + spreadGap;

    if (this.chTop) this.chTop.style.top = `${-totalGap - 8}px`;
    if (this.chBottom) this.chBottom.style.top = `${totalGap}px`;
    if (this.chLeft) this.chLeft.style.left = `${-totalGap - 8}px`;
    if (this.chRight) this.chRight.style.left = `${totalGap}px`;

    const color = isPinpoint ? '#00ff88' : '#ff334b';
    this.crosshairBars.forEach((el) => {
      (el as HTMLElement).style.background = color;
    });
  }

  public setScopeOverlay(visible: boolean): void {
    if (this.sniperScopeEl) {
      this.sniperScopeEl.style.display = visible ? 'block' : 'none';
    }
  }

  public updateRoundTimer(secondsRemaining: number, isBombArmed: boolean): void {
    if (this.roundTimerEl) {
      if (isBombArmed) {
        this.roundTimerEl.innerText = `⚠️ 00:${secondsRemaining.toString().padStart(2, '0')}`;
        this.roundTimerEl.style.color = '#ff2233';
      } else {
        const mins = Math.floor(secondsRemaining / 60);
        const secs = Math.floor(secondsRemaining % 60);
        this.roundTimerEl.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        this.roundTimerEl.style.color = '#fff';
      }
    }
  }

  public updateScores(ctScore: number, tScore: number): void {
    if (this.scoreCtEl) this.scoreCtEl.innerText = ctScore.toString();
    if (this.scoreTEl) this.scoreTEl.innerText = tScore.toString();
  }

  public addKillfeed(text: string): void {
    if (!this.killfeedEl) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerText = text;
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
    banner.style.zIndex = '80';

    const tEl = document.createElement('div');
    tEl.style.fontSize = '44px';
    tEl.style.fontWeight = '900';
    tEl.style.letterSpacing = '6px';
    tEl.style.textTransform = 'uppercase';
    tEl.style.color = title.includes('VANGUARD') ? '#3b9eff' : title.includes('SYNDICATE') ? '#ffaa00' : '#fff';
    tEl.style.textShadow = '0 0 20px rgba(0,0,0,0.9)';
    tEl.innerText = title;

    const sEl = document.createElement('div');
    sEl.style.fontSize = '16px';
    sEl.style.letterSpacing = '3px';
    sEl.style.color = '#c4c9ce';
    sEl.style.marginTop = '8px';
    sEl.innerText = subtitle;

    banner.appendChild(tEl);
    banner.appendChild(sEl);
    document.body.appendChild(banner);

    setTimeout(() => banner.remove(), durationMs);
  }

  public updateInteractionBar(progressRatio: number, label: string): void {
    let barContainer = document.getElementById('interaction-progress-container');
    if (!barContainer) {
      barContainer = document.createElement('div');
      barContainer.id = 'interaction-progress-container';
      barContainer.style.position = 'absolute';
      barContainer.style.bottom = '180px';
      barContainer.style.left = '50%';
      barContainer.style.transform = 'translateX(-50%)';
      barContainer.style.width = '300px';
      barContainer.style.textAlign = 'center';
      barContainer.style.pointerEvents = 'none';
      barContainer.style.zIndex = '70';

      barContainer.innerHTML = `
        <div id="interaction-label" style="font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #fff; margin-bottom: 6px;"></div>
        <div style="width: 100%; height: 8px; background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.3); border-radius: 4px; overflow: hidden;">
          <div id="interaction-fill" style="width: 0%; height: 100%; background: #00ff88; transition: width 0.05s linear;"></div>
        </div>
      `;
      document.body.appendChild(barContainer);
    }

    const fill = document.getElementById('interaction-fill');
    const lbl = document.getElementById('interaction-label');

    if (progressRatio > 0) {
      barContainer.style.display = 'block';
      if (fill) fill.style.width = `${Math.min(100, Math.round(progressRatio * 100))}%`;
      if (lbl) lbl.innerText = label;
    } else {
      barContainer.style.display = 'none';
    }
  }

  public renderDynamicScoreboard(vanguardTeam: ScoreboardPlayer[], syndicateTeam: ScoreboardPlayer[]): void {
    const tbody = document.getElementById('score-tbody');
    if (!tbody) return;

    let html = '';
    // Vanguard rows
    for (const p of vanguardTeam) {
      html += `
        <tr style="color: ${p.isAlive ? '#fff' : '#6b7280'};">
          <td style="color: #3b9eff; font-weight: 700;">${p.name}</td>
          <td>Garam Vanguard</td>
          <td>${p.kills}</td>
          <td>${p.deaths}</td>
          <td style="color: #00ff88;">${p.ping}ms</td>
        </tr>
      `;
    }
    // Syndicate rows
    for (const p of syndicateTeam) {
      html += `
        <tr style="color: ${p.isAlive ? '#fff' : '#6b7280'};">
          <td style="color: #ffaa00; font-weight: 700;">${p.name}</td>
          <td>Obsidian Syndicate</td>
          <td>${p.kills}</td>
          <td>${p.deaths}</td>
          <td style="color: #00ff88;">${p.ping}ms</td>
        </tr>
      `;
    }
    tbody.innerHTML = html;
  }
}
