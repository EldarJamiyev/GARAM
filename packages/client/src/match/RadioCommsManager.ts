import * as THREE from 'three';
import { BotEntity } from '../maps/CsOfficeMap.js';
import { ProceduralAudio } from '../audio/ProceduralAudio.js';
import { HUDManager } from '../ui/HUDManager.js';
import { buildBotChatterLine, BotChatterEvent } from '@garam/shared';

export interface RadioCommandDef {
  key: number;
  id: string;
  label: string;
  playerLine: string;
  botResponseEvent: BotChatterEvent;
}

export const RADIO_COMMANDS: readonly RadioCommandDef[] = [
  { key: 1, id: 'cover_me', label: 'Cover Me!', playerLine: 'Cover me!', botResponseEvent: 'ON_MY_WAY' },
  { key: 2, id: 'follow_me', label: 'Follow Me', playerLine: 'Follow me!', botResponseEvent: 'FOLLOWING_COMMANDER' },
  { key: 3, id: 'hold_pos', label: 'Hold This Position', playerLine: 'Hold this position.', botResponseEvent: 'HOLDING_POSITION' },
  { key: 4, id: 'need_backup', label: 'Need Backup!', playerLine: 'Taking fire, need backup!', botResponseEvent: 'ON_MY_WAY' },
  { key: 5, id: 'go_go', label: 'Go! Go! Go!', playerLine: 'Go go go — storm the front!', botResponseEvent: 'AFFIRMATIVE' },
  { key: 6, id: 'regroup', label: 'Regroup Team', playerLine: 'Regroup team!', botResponseEvent: 'ON_MY_WAY' },
  { key: 7, id: 'enemy_spotted', label: 'Enemy Spotted', playerLine: 'Enemy spotted!', botResponseEvent: 'AFFIRMATIVE' },
  { key: 8, id: 'sector_clear', label: 'Sector Clear', playerLine: 'Sector clear.', botResponseEvent: 'CLEAR' },
  { key: 9, id: 'report_in', label: 'Report In', playerLine: 'Team, report in!', botResponseEvent: 'CLEAR' },
];

export class RadioCommsManager {
  public isMenuOpen = false;
  private menuEl: HTMLElement | null = null;
  private audio: ProceduralAudio;
  private hud: HUDManager;

  // Bot escort / hold overrides read by BotAISystem or GameEventWire
  public escortBotId: string | null = null;
  public holdBotIds = new Set<string>();
  public assistTargetPos: THREE.Vector3 | null = null;
  public assistExpireAt = 0;

  constructor(audio: ProceduralAudio, hud: HUDManager) {
    this.audio = audio;
    this.hud = hud;
    this.buildMenuDom();
  }

  private buildMenuDom(): void {
    if (typeof document === 'undefined' || document.getElementById('cs16-radio-menu')) return;
    const el = document.createElement('div');
    el.id = 'cs16-radio-menu';
    el.style.cssText =
      'display:none; position:fixed; left:24px; top:50%; transform:translateY(-50%);' +
      'background:rgba(10,14,20,0.88); border:1px solid rgba(251,191,36,0.45); border-radius:4px;' +
      'padding:12px 16px; min-width:240px; z-index:75; font-size:12px; color:#f8fafc; pointer-events:none;';
    const title = document.createElement('div');
    title.style.cssText =
      'color:#fbbf24; font-weight:900; letter-spacing:1.5px; margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:4px;';
    title.textContent = '[H] RADIO COMMANDS';
    el.appendChild(title);
    for (const cmd of RADIO_COMMANDS) {
      const row = document.createElement('div');
      row.style.cssText = 'padding:2px 0; display:flex; gap:8px;';
      const keySpan = document.createElement('span');
      keySpan.style.cssText = 'color:#fbbf24;font-weight:800;';
      keySpan.textContent = `${cmd.key}.`;
      const lblSpan = document.createElement('span');
      lblSpan.textContent = cmd.label;
      row.appendChild(keySpan);
      row.appendChild(lblSpan);
      el.appendChild(row);
    }
    const exitRow = document.createElement('div');
    exitRow.style.cssText = 'margin-top:6px; color:#94a3b8; font-size:11px;';
    exitRow.textContent = '0 / H. Close Menu';
    el.appendChild(exitRow);
    document.body.appendChild(el);
    this.menuEl = el;
  }

  public toggleMenu(force?: boolean): void {
    this.isMenuOpen = force !== undefined ? force : !this.isMenuOpen;
    if (this.menuEl) this.menuEl.style.display = this.isMenuOpen ? 'block' : 'none';
  }

  public issueCommand(
    key: number,
    playerName: string,
    playerTeam: 'Vanguard' | 'Syndicate',
    playerPos: THREE.Vector3,
    callout: string,
    bots: BotEntity[]
  ): RadioCommandDef | null {
    if (key === 0) {
      this.toggleMenu(false);
      return null;
    }
    const cmd = RADIO_COMMANDS.find((c) => c.key === key);
    if (!cmd) return null;
    this.toggleMenu(false);

    this.hud.addRadioMessage(`[RADIO] ${playerName} @ ${callout}: "${cmd.playerLine}"`);
    this.audio.playRadioClick?.(cmd.playerLine, 1.0);

    // Find closest living ally bot to respond & obey
    const allies = bots.filter((b) => b.team === playerTeam && !b.isDead);
    if (allies.length === 0) return cmd;
    allies.sort((a, b) => a.mesh.position.distanceToSquared(playerPos) - b.mesh.position.distanceToSquared(playerPos));
    const responder = allies[0];

    if (cmd.id === 'follow_me' || cmd.id === 'cover_me') {
      this.escortBotId = responder.id;
      this.holdBotIds.delete(responder.id);
      this.assistTargetPos = playerPos.clone();
      this.assistExpireAt = performance.now() + 18000;
    } else if (cmd.id === 'hold_pos') {
      this.holdBotIds.add(responder.id);
      if (this.escortBotId === responder.id) this.escortBotId = null;
    } else if (cmd.id === 'need_backup' || cmd.id === 'regroup') {
      this.assistTargetPos = playerPos.clone();
      this.assistExpireAt = performance.now() + 14000;
    } else if (cmd.id === 'go_go') {
      this.holdBotIds.clear();
      this.escortBotId = null;
    }

    setTimeout(() => {
      if (responder.isDead) return;
      const line = buildBotChatterLine(cmd.botResponseEvent, callout);
      this.hud.addRadioMessage(`[RADIO] ${responder.name}: "${line.text}"`);
      this.audio.playRadioClick?.(line.text, 0.96);
    }, 650);

    return cmd;
  }

  public resetRound(): void {
    this.escortBotId = null;
    this.holdBotIds.clear();
    this.assistTargetPos = null;
    this.toggleMenu(false);
  }
}
