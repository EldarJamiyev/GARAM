import { PlayerInput } from '@garam/shared';

export type GameUIState = 'PLAYING' | 'BUY_MENU' | 'SCOREBOARD' | 'SETTINGS' | 'PAUSED';

export interface InputCallbacks {
  onFireDown: () => void;
  onFireUp: () => void;
  onAltFire: () => void;
  onReload: () => void;
  onQuickSwitch: () => void;
  onCycleWeapon?: (dir: 1 | -1) => void;
  onSlotSelect: (slot: 1 | 2 | 3 | 4 | 5) => void;
  onToggleBuyMenu: () => void;
  onBuyItem?: (itemKey: number) => void;
  onInteractDown: () => void; // E key for plant / defuse
  onInteractUp: () => void;
  onPracticeToggle: () => void; // P key for $16K dev test
  onInspectWeapon?: () => void; // F key for inspect
  onDropWeapon?: () => void; // G key for drop weapon
  onUtilityQuickSelect?: (type: 'smoke' | 'flash' | 'he' | 'molotov') => void;
  onToggleCustomizer?: () => void; // F2 key for live customizer lab
  onAutoBuy?: () => void; // F1 key
  onRebuy?: () => void; // F4 key
  onToggleRadioMenu?: () => void; // H key
  onRadioCommand?: (num: number) => void; // Digit 0-9 when radio menu is open
  onSprayLogo?: () => void; // T key
  onToggleNightVision?: () => void; // N key
  onBuyAmmo?: (kind: 'primary' | 'secondary') => void; // Comma / Period
  onCycleSpectatorMode?: () => void; // Space while spectating
  isRadioMenuOpen?: () => boolean;
  isSpectating?: () => boolean;
}

// Source engine standard m_yaw: 0.022 degrees per mouse count
const SOURCE_M_YAW_RAD = 0.022 * (Math.PI / 180);

export class InputManager {
  public input: PlayerInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    jump: false,
    crouch: false,
    walk: false,
    yaw: 0,
    pitch: 0,
  };

  public mouseDeltaX = 0;
  public mouseDeltaY = 0;
  public isLocked = false;
  public uiState: GameUIState = 'PAUSED';
  public isInteracting = false; // E key hold

  // Source-calibrated mouse sensitivity
  public mouseSensitivity = SOURCE_M_YAW_RAD * 2.2;

  // Jump buffer (100ms window)
  private jumpBufferRemaining = 0;
  private spaceKeyHeld = false;

  // Lock acquisition frame guard (filters first 2 frame spike deltas)
  private lockAcquiredFrames = 0;

  private canvas: HTMLCanvasElement;
  private blocker: HTMLElement;
  private callbacks: InputCallbacks;

  constructor(canvas: HTMLCanvasElement, blocker: HTMLElement, callbacks: InputCallbacks) {
    this.canvas = canvas;
    this.blocker = blocker;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  public resetMovementInputs(): void {
    this.input.forward = false;
    this.input.backward = false;
    this.input.left = false;
    this.input.right = false;
    this.input.jump = false;
    this.input.crouch = false;
    this.input.walk = false;
    this.spaceKeyHeld = false;
    this.jumpBufferRemaining = 0;
  }

  public update(dt: number, isGrounded: boolean): void {
    if (this.jumpBufferRemaining > 0) {
      this.jumpBufferRemaining -= dt;
      if (isGrounded) {
        this.input.jump = true;
        this.jumpBufferRemaining = 0;
      }
    } else if (!this.spaceKeyHeld) {
      this.input.jump = false;
    }
  }

  private bindEvents(): void {
    // Click blocker to enter game
    this.blocker.addEventListener('click', () => {
      if (this.uiState === 'PAUSED') {
        this.requestPointerLock();
      }
    });

    // PointerLock state synchronization
    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.canvas;
      const overlay = document.getElementById('ui-overlay');

      if (this.isLocked) {
        this.uiState = 'PLAYING';
        this.lockAcquiredFrames = 2; // Filter first 2 frames after lock acquisition
        this.blocker.style.display = 'none';
        if (overlay) overlay.style.display = 'block';
        document.body.dataset.state = 'playing';
      } else {
        this.resetMovementInputs();
        if (overlay) overlay.style.display = 'none';
        if (this.uiState === 'PLAYING') {
          this.uiState = 'PAUSED';
          this.blocker.style.display = 'flex';
          document.body.dataset.state = 'paused';
        }
      }
    });

    // Window blur safety: release all keys
    window.addEventListener('blur', () => {
      this.resetMovementInputs();
    });

    // Raw mouse movement with delta spike filtering
    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;

      // Filter transient pointer lock re-centering jump
      if (this.lockAcquiredFrames > 0) {
        this.lockAcquiredFrames--;
        return;
      }

      // Filter extreme browser mouse teleport spikes (> 350px per event)
      if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) {
        return;
      }

      this.mouseDeltaX = e.movementX;
      this.mouseDeltaY = e.movementY;

      this.input.yaw -= e.movementX * this.mouseSensitivity;
      this.input.pitch -= e.movementY * this.mouseSensitivity;

      // Pitch clamping (-88 deg to +88 deg)
      const maxPitch = (Math.PI / 2) - 0.02;
      this.input.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.input.pitch));
    });

    const isEditableElement = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    };

    window.addEventListener('keydown', (e) => {
      // Never intercept typing inside callsign, server URL, or customizer form fields
      if (isEditableElement(e.target) && e.code !== 'Escape') {
        return;
      }

      // F1 Auto-Buy & F4 Re-Buy
      if (e.code === 'F1') {
        if (e.repeat) return;
        e.preventDefault();
        this.callbacks.onAutoBuy?.();
        return;
      }
      if (e.code === 'F4') {
        if (e.repeat) return;
        e.preventDefault();
        this.callbacks.onRebuy?.();
        return;
      }

      // F2 Sandbox Customizer
      if (e.code === 'F2') {
        if (e.repeat) return;
        e.preventDefault();
        this.callbacks.onToggleCustomizer?.();
        return;
      }

      // Practice Dev Toggle
      if (e.code === 'KeyP') {
        if (e.repeat) return;
        this.callbacks.onPracticeToggle();
        return;
      }

      // Radio Comms Menu (H Key)
      if (e.code === 'KeyH') {
        if (e.repeat) return;
        this.callbacks.onToggleRadioMenu?.();
        return;
      }

      // If Radio Menu is open, Digit 0-9 issue tactical radio commands
      if (this.callbacks.isRadioMenuOpen?.()) {
        if ((e.code.startsWith('Digit') || e.code.startsWith('Numpad')) && !e.repeat) {
          const num = parseInt(e.code.replace('Digit', '').replace('Numpad', ''), 10);
          if (!Number.isNaN(num) && num >= 0 && num <= 9) {
            this.callbacks.onRadioCommand?.(num);
            return;
          }
        }
      }

      // Buy Menu (B Key)
      if (e.code === 'KeyB') {
        if (e.repeat) return;
        this.callbacks.onToggleBuyMenu();
        return;
      }

      // If Buy Menu is open (both state AND visible DOM), Digit 1-8 buy items directly
      const buyMenuEl = document.getElementById('buy-menu');
      const isBuyMenuOpen =
        this.uiState === 'BUY_MENU' ||
        (buyMenuEl !== null && getComputedStyle(buyMenuEl).display === 'block');
      if (isBuyMenuOpen) {
        if (e.code.startsWith('Digit') && !e.repeat) {
          const num = parseInt(e.code.replace('Digit', ''), 10);
          if (num >= 1 && num <= 8 && this.callbacks.onBuyItem) {
            this.callbacks.onBuyItem(num);
            return;
          }
        }
      }

      // Escape key handles closing modals cleanly
      if (e.code === 'Escape') {
        if (e.repeat) return;
        if (this.callbacks.isRadioMenuOpen?.()) {
          this.callbacks.onToggleRadioMenu?.();
          return;
        }
        const custEl = document.getElementById('customizer-modal');
        if (custEl && getComputedStyle(custEl).display !== 'none') {
          this.callbacks.onToggleCustomizer?.();
          return;
        }
        if (isBuyMenuOpen) {
          this.callbacks.onToggleBuyMenu();
          return;
        }
      }

      // Scoreboard (TAB)
      if (e.code === 'Tab') {
        e.preventDefault();
        const sb = document.getElementById('scoreboard-modal');
        if (sb) sb.style.display = 'block';
        return;
      }

      if (e.code === 'KeyE') {
        if (!e.repeat) {
          this.isInteracting = true;
          this.callbacks.onInteractDown();
        }
        return;
      }

      // Space key: cycle spectator mode if spectating, otherwise 100ms Jump Buffer
      if (e.code === 'Space') {
        if (!e.repeat) {
          if (this.callbacks.isSpectating?.()) {
            this.callbacks.onCycleSpectatorMode?.();
            return;
          }
          this.spaceKeyHeld = true;
          this.input.jump = true;
          this.jumpBufferRemaining = 0.10; // 100ms buffer
        }
        return;
      }

      const code = e.code;
      const key = e.key ? e.key.toLowerCase() : '';

      // Directional Movement: W/A/S/D + Arrows + International & Cyrillic Layout mapping
      if (code === 'KeyW' || key === 'w' || key === 'ц' || code === 'ArrowUp') {
        this.input.forward = true;
        return;
      }
      if (code === 'KeyS' || key === 's' || key === 'ы' || code === 'ArrowDown') {
        this.input.backward = true;
        return;
      }
      if (code === 'KeyA' || key === 'a' || key === 'ф' || code === 'ArrowLeft') {
        this.input.left = true;
        return;
      }
      if (code === 'KeyD' || key === 'd' || key === 'в' || code === 'ArrowRight') {
        this.input.right = true;
        return;
      }

      if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
        this.input.crouch = true;
        return;
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.input.walk = true;
        return;
      }

      // Suppress auto-repeat on discrete weapon/utility actions
      if (e.repeat) return;

      switch (e.code) {
        case 'KeyR': this.callbacks.onReload(); break;
        case 'KeyQ': this.callbacks.onQuickSwitch(); break;
        case 'KeyF': this.callbacks.onInspectWeapon?.(); break;
        case 'KeyG': this.callbacks.onDropWeapon?.(); break;
        case 'KeyT': this.callbacks.onSprayLogo?.(); break;
        case 'KeyN': this.callbacks.onToggleNightVision?.(); break;
        case 'Comma': this.callbacks.onBuyAmmo?.('primary'); break;
        case 'Period': this.callbacks.onBuyAmmo?.('secondary'); break;
        case 'KeyZ': this.callbacks.onUtilityQuickSelect?.('smoke'); break;
        case 'KeyX': this.callbacks.onUtilityQuickSelect?.('flash'); break;
        case 'KeyC': this.callbacks.onUtilityQuickSelect?.('he'); break;
        case 'KeyV': this.callbacks.onUtilityQuickSelect?.('molotov'); break;
        case 'Digit1':
        case 'Numpad1': this.callbacks.onSlotSelect(1); break;
        case 'Digit2':
        case 'Numpad2': this.callbacks.onSlotSelect(2); break;
        case 'Digit3':
        case 'Numpad3': this.callbacks.onSlotSelect(3); break;
        case 'Digit4':
        case 'Numpad4': this.callbacks.onSlotSelect(4); break;
        case 'Digit5':
        case 'Numpad5': this.callbacks.onSlotSelect(5); break;
        default:
          if (e.key === '1') this.callbacks.onSlotSelect(1);
          else if (e.key === '2') this.callbacks.onSlotSelect(2);
          else if (e.key === '3') this.callbacks.onSlotSelect(3);
          else if (e.key === '4') this.callbacks.onSlotSelect(4);
          else if (e.key === '5') this.callbacks.onSlotSelect(5);
          break;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab') {
        const sb = document.getElementById('scoreboard-modal');
        if (sb) sb.style.display = 'none';
        return;
      }

      if (e.code === 'KeyE') {
        this.isInteracting = false;
        this.callbacks.onInteractUp();
        return;
      }

      if (e.code === 'Space') {
        this.spaceKeyHeld = false;
        if (this.jumpBufferRemaining <= 0) {
          this.input.jump = false;
        }
        return;
      }

      const code = e.code;
      const key = e.key ? e.key.toLowerCase() : '';

      // Directional Movement Release
      if (code === 'KeyW' || key === 'w' || key === 'ц' || code === 'ArrowUp') {
        this.input.forward = false;
        return;
      }
      if (code === 'KeyS' || key === 's' || key === 'ы' || code === 'ArrowDown') {
        this.input.backward = false;
        return;
      }
      if (code === 'KeyA' || key === 'a' || key === 'ф' || code === 'ArrowLeft') {
        this.input.left = false;
        return;
      }
      if (code === 'KeyD' || key === 'd' || key === 'в' || code === 'ArrowRight') {
        this.input.right = false;
        return;
      }

      switch (e.code) {
        case 'ControlLeft':
        case 'ControlRight':
          this.input.crouch = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.input.walk = false;
          break;
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (this.isLocked) {
        if (e.button === 0) {
          this.callbacks.onFireDown();
        } else if (e.button === 2) {
          this.callbacks.onAltFire();
        }
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.callbacks.onFireUp();
      }
    });

    window.addEventListener('wheel', (e) => {
      if (!this.isLocked || this.uiState !== 'PLAYING') return;
      if (e.deltaY > 0) {
        if (this.callbacks.onCycleWeapon) this.callbacks.onCycleWeapon(1);
      } else if (e.deltaY < 0) {
        if (this.callbacks.onCycleWeapon) this.callbacks.onCycleWeapon(-1);
      }
    }, { passive: true });

    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /**
   * Requests pointer lock with unadjusted movement (raw input) with robust fallback
   * and catches unhandled promise rejections cleanly.
   */
  public requestPointerLock(): void {
    if (this.isLocked) return;

    const canvasWithOpts = this.canvas as HTMLCanvasElement & {
      requestPointerLock: (options?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    };

    try {
      const promise = canvasWithOpts.requestPointerLock({ unadjustedMovement: true });
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          try {
            const fallback = this.canvas.requestPointerLock();
            if (fallback && typeof fallback.catch === 'function') {
              fallback.catch(() => {});
            }
          } catch {
            // Pointer lock unavailable (e.g. headless browser)
          }
        });
      }
    } catch {
      try {
        const fallback = this.canvas.requestPointerLock();
        if (fallback && typeof fallback.catch === 'function') {
          fallback.catch(() => {});
        }
      } catch {
        // Pointer lock unavailable
      }
    }
  }

  public exitPointerLock(): void {
    if (this.isLocked) {
      document.exitPointerLock();
    }
  }

  /**
   * Sets mouse sensitivity scaled to Source standard m_yaw
   * @param multiplier user sensitivity slider value (e.g. 2.2)
   */
  public setSensitivity(multiplier: number): void {
    this.mouseSensitivity = SOURCE_M_YAW_RAD * multiplier;
  }
}
