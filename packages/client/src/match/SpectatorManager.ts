import * as THREE from 'three';
import { BotEntity } from '../maps/DeCitadelMap.js';
import { settingsStore } from '../core/SettingsStore.js';

const _forward = new THREE.Vector3();
const _camPos = new THREE.Vector3();

export class SpectatorManager {
  public isSpectating = false;
  private spectateIndex = 0;
  private bannerEl: HTMLElement | null = null;
  private deathCamTimer = 0;
  private deathCamTarget: THREE.Vector3 | null = null;
  private lastBannerKey = '';

  constructor() {
    this.createBannerDom();
  }

  private createBannerDom(): void {
    let el = document.getElementById('spectator-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'spectator-banner';
      el.style.position = 'absolute';
      el.style.bottom = '110px';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.background = 'rgba(12, 16, 22, 0.94)';
      el.style.border = '1px solid rgba(59, 158, 255, 0.4)';
      el.style.borderRadius = '6px';
      el.style.padding = '8px 24px';
      el.style.fontSize = '13px';
      el.style.fontWeight = '800';
      el.style.letterSpacing = '1.5px';
      el.style.color = '#fff';
      el.style.display = 'none';
      el.style.zIndex = '60';
      el.style.pointerEvents = 'none';
      el.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.7)';
      document.body.appendChild(el);
    }
    this.bannerEl = el;
  }

  private getLivingAllies(bots: BotEntity[]): BotEntity[] {
    const localTeam = settingsStore.settings.faction;
    return bots.filter((b) => b.team === localTeam && !b.isDead);
  }

  public startDeathCam(killerPos: THREE.Vector3 | null): void {
    this.isSpectating = true;
    this.deathCamTimer = 1.2;
    this.deathCamTarget = killerPos ? killerPos.clone() : null;
    this.spectateIndex = 0;
    this.lastBannerKey = '';
  }

  public cycleTeammate(direction: 1 | -1, bots: BotEntity[]): void {
    const livingAllies = this.getLivingAllies(bots);
    if (livingAllies.length === 0) return;

    this.spectateIndex = (this.spectateIndex + direction + livingAllies.length) % livingAllies.length;
    this.updateBanner(livingAllies[this.spectateIndex]);
  }

  public getActiveSpectatedBot(bots: BotEntity[]): BotEntity | null {
    const livingAllies = this.getLivingAllies(bots);
    if (livingAllies.length === 0) return null;
    this.spectateIndex = Math.min(this.spectateIndex, livingAllies.length - 1);
    return livingAllies[this.spectateIndex];
  }

  public update(dt: number, camera: THREE.PerspectiveCamera, bots: BotEntity[]): void {
    if (!this.isSpectating) return;

    if (this.deathCamTimer > 0) {
      this.deathCamTimer -= dt;
      if (this.deathCamTarget) {
        camera.lookAt(this.deathCamTarget.x, this.deathCamTarget.y + 1.4, this.deathCamTarget.z);
      }
      return;
    }

    const livingAllies = this.getLivingAllies(bots);
    if (livingAllies.length === 0) {
      this.stop();
      return;
    }

    const targetBot = livingAllies[this.spectateIndex % livingAllies.length];
    if (targetBot) {
      const pos = targetBot.mesh.position;
      _forward.set(0, 0, 1).applyEuler(targetBot.mesh.rotation);
      _camPos.set(pos.x, pos.y + 1.85, pos.z).addScaledVector(_forward, -2.2);
      camera.position.lerp(_camPos, Math.min(1.0, 18 * dt));
      camera.lookAt(pos.x, pos.y + 1.6, pos.z);
      this.updateBanner(targetBot);
    }
  }

  private updateBanner(bot: BotEntity): void {
    if (!this.bannerEl) return;
    const key = `${bot.id}:${Math.round(bot.health)}`;
    if (key === this.lastBannerKey) return;
    this.lastBannerKey = key;

    const accent = bot.team === 'Syndicate' ? '#f59e0b' : '#3b9eff';
    this.bannerEl.style.display = 'block';
    this.bannerEl.textContent = '';

    const labelSpan = document.createElement('span');
    labelSpan.style.color = accent;
    labelSpan.textContent = 'SPECTATING: ';

    const nameText = document.createTextNode(`${bot.name.toUpperCase()} • `);

    const hpSpan = document.createElement('span');
    hpSpan.style.color = '#00ff88';
    hpSpan.textContent = `${Math.round(bot.health)} HP`;

    const sepText = document.createTextNode(' • GARAM-47  |  ');

    const hintSpan = document.createElement('span');
    hintSpan.style.color = '#8e959e';
    hintSpan.style.fontSize = '11px';
    hintSpan.textContent = '[M1 / M2] CYCLE TEAMMATE';

    this.bannerEl.append(labelSpan, nameText, hpSpan, sepText, hintSpan);
  }

  public stop(): void {
    this.isSpectating = false;
    this.deathCamTimer = 0;
    this.deathCamTarget = null;
    this.lastBannerKey = '';
    if (this.bannerEl) {
      this.bannerEl.style.display = 'none';
    }
  }
}
