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
  onUtilityQuickSelect?: (type: 'smoke' | 'flash' | 'he' | 'molotov') => void;
}

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

  private canvas: HTMLCanvasElement;
  private blocker: HTMLElement;
  private callbacks: InputCallbacks;
  public mouseSensitivity = 0.0022;

  constructor(canvas: HTMLCanvasElement, blocker: HTMLElement, callbacks: InputCallbacks) {
    this.canvas = canvas;
    this.blocker = blocker;
    this.callbacks = callbacks;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Click blocker to enter game
    this.blocker.addEventListener('click', () => {
      if (this.uiState === 'PAUSED') {
        this.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = document.pointerLockElement === this.canvas;
      const overlay = document.getElementById('ui-overlay');
      if (this.isLocked) {
        this.uiState = 'PLAYING';
        this.blocker.style.display = 'none';
        if (overlay) overlay.style.display = 'block';
      } else {
        if (this.uiState === 'PLAYING') {
          this.uiState = 'PAUSED';
          this.blocker.style.display = 'flex';
          if (overlay) overlay.style.display = 'none';
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.mouseDeltaX = e.movementX;
      this.mouseDeltaY = e.movementY;

      this.input.yaw -= e.movementX * this.mouseSensitivity;
      this.input.pitch -= e.movementY * this.mouseSensitivity;

      const maxPitch = (Math.PI / 2) - 0.02;
      this.input.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.input.pitch));
    });

    window.addEventListener('keydown', (e) => {
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

      // If Buy Menu is open, Digit 1-8 buy items directly
      if (this.uiState === 'BUY_MENU') {
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
        if (this.uiState === 'BUY_MENU') {
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

      switch (e.code) {
        case 'KeyW': this.input.forward = true; break;
        case 'KeyS': this.input.backward = true; break;
        case 'KeyA': this.input.left = true; break;
        case 'KeyD': this.input.right = true; break;
        case 'Space': this.input.jump = true; break;
        case 'ControlLeft': this.input.crouch = true; break;
        case 'ShiftLeft': this.input.walk = true; break;
        case 'KeyR': this.callbacks.onReload(); break;
        case 'KeyQ': this.callbacks.onQuickSwitch(); break;
        case 'KeyF': this.callbacks.onInspectWeapon?.(); break;
        case 'KeyZ': this.callbacks.onUtilityQuickSelect?.('flash'); break;
        case 'KeyX': this.callbacks.onUtilityQuickSelect?.('smoke'); break;
        case 'KeyC': this.callbacks.onUtilityQuickSelect?.('he'); break;
        case 'KeyV': this.callbacks.onUtilityQuickSelect?.('molotov'); break;
        case 'Digit1': this.callbacks.onSlotSelect(1); break;
        case 'Digit2': this.callbacks.onSlotSelect(2); break;
        case 'Digit3': this.callbacks.onSlotSelect(3); break;
        case 'Digit4': this.callbacks.onSlotSelect(4); break;
        case 'Digit5': this.callbacks.onSlotSelect(5); break;
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

      switch (e.code) {
        case 'KeyW': this.input.forward = false; break;
        case 'KeyS': this.input.backward = false; break;
        case 'KeyA': this.input.left = false; break;
        case 'KeyD': this.input.right = false; break;
        case 'Space': this.input.jump = false; break;
        case 'ControlLeft': this.input.crouch = false; break;
        case 'ShiftLeft': this.input.walk = false; break;
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

  public requestPointerLock(): void {
    this.canvas.requestPointerLock();
  }

  public exitPointerLock(): void {
    if (this.isLocked) {
      document.exitPointerLock();
    }
  }

  public setSensitivity(sens: number): void {
    this.mouseSensitivity = sens;
  }
}
