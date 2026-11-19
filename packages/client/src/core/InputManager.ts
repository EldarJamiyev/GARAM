import { PlayerInput } from '@garam/shared';

export type GameUIState = 'PLAYING' | 'BUY_MENU' | 'SCOREBOARD' | 'PAUSED';

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
      } else {
        this.resetMovementInputs();
        if (overlay) overlay.style.display = 'none';
        if (this.uiState === 'PLAYING') {
          this.uiState = 'PAUSED';
          this.blocker.style.display = 'flex';
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

    window.addEventListener('keydown', (e) => {
      // F2 Sandbox Customizer
      if (e.code === 'F2') {
        e.preventDefault();
        this.callbacks.onToggleCustomizer?.();
        return;
      }

      // Practice Dev Toggle
      if (e.code === 'KeyP') {
        this.callbacks.onPracticeToggle();
        return;
      }

      // Buy Menu (B Key)
      if (e.code === 'KeyB') {
        this.callbacks.onToggleBuyMenu();
        return;
      }

      // If Buy Menu is open (both state AND visible DOM), Digit 1-8 buy items directly
      const buyMenuEl = document.getElementById('buy-menu');
      const isBuyMenuOpen = (this.uiState === 'BUY_MENU' || (buyMenuEl && getComputedStyle(buyMenuEl).display === 'block'));
      if (isBuyMenuOpen) {
        if (e.code.startsWith('Digit')) {
          const num = parseInt(e.code.replace('Digit', ''), 10);
          if (num >= 1 && num <= 8 && this.callbacks.onBuyItem) {
            this.callbacks.onBuyItem(num);
            return;
          }
        }
      }

      // Escape key handles closing modals cleanly
      if (e.code === 'Escape') {
        if (this.uiState === 'BUY_MENU' || (buyMenuEl && getComputedStyle(buyMenuEl).display === 'block')) {
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
        this.isInteracting = true;
        this.callbacks.onInteractDown();
        return;
      }

      // Space key with 100ms Jump Buffer
      if (e.code === 'Space') {
        this.spaceKeyHeld = true;
        this.input.jump = true;
        this.jumpBufferRemaining = 0.10; // 100ms buffer
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

      switch (e.code) {
        case 'ControlLeft':
        case 'ControlRight':
          this.input.crouch = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          this.input.walk = true;
          break;
        case 'KeyR': this.callbacks.onReload(); break;
        case 'KeyQ': this.callbacks.onQuickSwitch(); break;
        case 'KeyF': this.callbacks.onInspectWeapon?.(); break;
        case 'KeyG': this.callbacks.onDropWeapon?.(); break;
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

    try {
      const opts = { unadjustedMovement: true };
      const promise = (this.canvas.requestPointerLock as any)(opts);
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          try {
            const fallback = this.canvas.requestPointerLock();
            if (fallback && typeof fallback.catch === 'function') {
              fallback.catch(() => {});
            }
          } catch {}
        });
      }
    } catch {
      try {
        const fallback = this.canvas.requestPointerLock();
        if (fallback && typeof fallback.catch === 'function') {
          fallback.catch(() => {});
        }
      } catch {}
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
