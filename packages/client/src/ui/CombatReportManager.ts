export interface DamageEntry {
  targetId: string;
  name: string;
  damage: number;
  hits: number;
  headshots: number;
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

export class CombatReportManager {
  private damageGiven: Map<string, DamageEntry> = new Map();
  private damageTaken: Map<string, DamageEntry> = new Map();
  private cardEl: HTMLElement | null = null;

  constructor() {
    this.createDomElement();
  }

  private createDomElement(): void {
    let el = document.getElementById('combat-report-card');
    if (!el) {
      el = document.createElement('div');
      el.id = 'combat-report-card';
      el.style.position = 'absolute';
      el.style.top = '120px';
      el.style.right = '28px';
      el.style.width = '340px';
      el.style.background = 'rgba(12, 16, 22, 0.94)';
      el.style.border = '1px solid rgba(255, 255, 255, 0.16)';
      el.style.borderRadius = '8px';
      el.style.padding = '14px 18px';
      el.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.8)';
      el.style.color = '#fff';
      el.style.fontFamily = "'Segoe UI', sans-serif";
      el.style.display = 'none';
      el.style.zIndex = '60';
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
    }
    this.cardEl = el;
  }

  public recordDamageGiven(targetId: string, name: string, dmg: number, isHeadshot = false): void {
    const existing = this.damageGiven.get(targetId) || {
      targetId,
      name,
      damage: 0,
      hits: 0,
      headshots: 0,
    };
    existing.damage += dmg;
    existing.hits++;
    if (isHeadshot) existing.headshots++;
    this.damageGiven.set(targetId, existing);
  }

  public recordDamageTaken(attackerId: string, name: string, dmg: number, isHeadshot = false): void {
    const existing = this.damageTaken.get(attackerId) || {
      targetId: attackerId,
      name,
      damage: 0,
      hits: 0,
      headshots: 0,
    };
    existing.damage += dmg;
    existing.hits++;
    if (isHeadshot) existing.headshots++;
    this.damageTaken.set(attackerId, existing);
  }

  public resetRound(): void {
    this.damageGiven.clear();
    this.damageTaken.clear();
    this.hide();
  }

  public show(): void {
    if (!this.cardEl) return;

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.12); padding-bottom: 8px; margin-bottom: 10px;">
        <span style="font-size: 13px; font-weight: 800; letter-spacing: 2px; color: #00ff88;">COMBAT REPORT</span>
        <span style="font-size: 11px; color: #8e959e;">CURRENT ROUND</span>
      </div>
    `;

    // Given Section
    html += `<div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #3b9eff; margin-bottom: 6px;">DAMAGE GIVEN</div>`;
    if (this.damageGiven.size === 0) {
      html += `<div style="font-size: 12px; color: #6b7280; margin-bottom: 10px;">None</div>`;
    } else {
      this.damageGiven.forEach((entry) => {
        const hsText = entry.headshots > 0 ? ` (${entry.headshots} HS)` : '';
        html += `
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
            <span style="color: #fff; font-weight: 600;">➔ ${escapeHtml(entry.name)}</span>
            <span style="color: #00ff88; font-weight: 700;">${entry.damage} in ${entry.hits} hit${entry.hits > 1 ? 's' : ''}${hsText}</span>
          </div>
        `;
      });
      html += `<div style="margin-bottom: 10px;"></div>`;
    }

    // Taken Section
    html += `<div style="font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #ff4455; margin-bottom: 6px;">DAMAGE TAKEN</div>`;
    if (this.damageTaken.size === 0) {
      html += `<div style="font-size: 12px; color: #6b7280;">None</div>`;
    } else {
      this.damageTaken.forEach((entry) => {
        const hsText = entry.headshots > 0 ? ` (${entry.headshots} HS)` : '';
        html += `
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 4px;">
            <span style="color: #fff; font-weight: 600;">← ${escapeHtml(entry.name)}</span>
            <span style="color: #ff4455; font-weight: 700;">${entry.damage} in ${entry.hits} hit${entry.hits > 1 ? 's' : ''}${hsText}</span>
          </div>
        `;
      });
    }

    this.cardEl.innerHTML = html;
    this.cardEl.style.display = 'block';
  }

  public hide(): void {
    if (this.cardEl) {
      this.cardEl.style.display = 'none';
    }
  }

  public static formatKillfeedEntry(
    killerName: string,
    victimName: string,
    weaponName: string,
    isHeadshot: boolean,
    isWallbang = false,
    isThroughSmoke = false,
    isBackstab = false
  ): string {
    const badges: string[] = [];
    if (isHeadshot) badges.push('🎯');
    if (isWallbang) badges.push('🧱');
    if (isThroughSmoke) badges.push('☁️');
    if (isBackstab) badges.push('🗡️');

    const badgeStr = badges.length > 0 ? ` [${badges.join(' ')}]` : '';
    return `💀 ${killerName} [${weaponName}]${badgeStr} ${victimName}`;
  }
}
